import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuctionBidStatus,
  AuctionSettlementStatus,
  AuctionStatus,
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
  SecondChanceOfferStatus,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { WalletService } from '../../../wallet/wallet.service';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { PaymentsService } from '../../../payments/payments.service';
import { NotificationService } from '../../../notification/notification.service';
import { OperationalNotifyService } from '../../../notification/operational-notify.service';
import { ExchangeOrderNotifyService } from '../../../notification/exchange-order-notify.service';
import { OrderReputationService } from '../../order-reputation.service';
import { ExchangeService } from '../../../exchange/exchange.service';
import { QuotaService } from '../../../quota/quota.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import {
  clearedOrderVideoUpdateData,
  collectOrderVideoFilenames,
  deleteOrderVideoFile,
  orderHasStoredVideos,
} from '../../../../common/upload/order-video-storage.util';
import { enrichOrderUpdateForCompletion } from '../../order-lifecycle.util';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import {
  isPaymentTimeoutCancelledForActiveOffer,
  isPaymentTimeoutCancelledOrder,
  prepareListingSlotForExchangeCheckout,
} from '../../exchange-listing-order.util';
import {
  assertExchangeOrderOpenForCheckout,
  EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES,
  EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES,
  exchangeTerminalUserMessage,
  isExchangeOrderPaymentPending,
  isExchangeOrderTerminalForUserActions,
  isExchangePaymentTimeoutCancelReason,
  isResumableExchangeCheckoutOrder,
  reconcileExchangeOfferStatusWithOrder,
} from '../../exchange-order-sync.util';
import { formatMinutesDurationFa } from '../../../../common/duration-format.util';
import { OrdersSettingsService } from '../../orders-settings.service';
import { OrdersResponseEnrichmentService } from '../query/orders-response-enrichment.service';
import {
  AWAITING_SELLER_SHIPMENT_STATUSES,
  EXCHANGE_PEER_SHIP_WAIT_STATUSES,
  PURGE_COMPLETED_ORDER_VIDEOS_BATCH,
} from '../../orders.constants';
import { BUYER_CONFIRM_ELIGIBLE_STATUSES } from '../query/orders-response-enrichment.service';

import { OrdersSchedulerService } from '../scheduler/orders-scheduler.service';

@Injectable()
export class OrdersCompletionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notificationService: NotificationService,
    private readonly operationalNotify: OperationalNotifyService,
    private readonly appSettings: AppSettingsService,
    private readonly orderReputation: OrderReputationService,
    private readonly exchangeService: ExchangeService,
    private readonly quotaService: QuotaService,
    private readonly listingCommand: ListingCommandService,
    private readonly settings: OrdersSettingsService,
    private readonly responseEnrichment: OrdersResponseEnrichmentService,
  ) {}

  async submitReturnTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    if (!/^\d{24}$/.test(trackingCode)) {
      throw new BadRequestException('کد رهگیری باید دقیقاً ۲۴ رقم باشد.');
    }
    if (!videoPath) {
      throw new BadRequestException('ویدیوی بسته‌بندی مرجوعی الزامی است.');
    }

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.type === OrderType.EXCHANGE) {
      throw new BadRequestException(
        'ثبت مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست',
      );
    }
    if (order.buyerId !== userId) {
      throw new ForbiddenException('فقط خریدار می‌تواند مرجوعی را ثبت کند');
    }
    if (order.status !== OrderStatus.RETURN_REQUESTED) {
      throw new BadRequestException(
        'این سفارش در وضعیت مناسب برای ثبت مرجوعی نیست',
      );
    }
    if (order.returnTrackingCode) {
      throw new BadRequestException('کد رهگیری مرجوعی قبلاً ثبت شده است');
    }

    const minutes = await this.settings.getSellerReturnConfirmDeadlineMinutes();
    const returnConfirmDeadline = new Date(Date.now() + minutes * 60 * 1000);

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        returnTrackingCode: trackingCode,
        returnPackagingVideo: videoPath,
        returnShippedAt: new Date(),
        returnConfirmDeadline,
        status: OrderStatus.RETURN_SHIPPED,
      },
    });

    await this.notificationService.create({
      userId: updated.sellerId,
      type: NotificationType.ORDER_STATUS_CHANGED,
      title: 'مرجوعی ثبت شد — تایید دریافت',
      message: `خریدار مرجوعی سفارش #${orderId.slice(-6)} را ارسال کرد. تا پایان مهلت، دریافت را تایید کنید؛ در غیر این صورت به‌صورت خودکار تایید و بازگشت وجه انجام می‌شود.`,
      meta: {
        orderId,
        status: OrderStatus.RETURN_SHIPPED,
        returnConfirmDeadline: returnConfirmDeadline.toISOString(),
      },
    });

    return updated;
  }

  async confirmReturnReceipt(sellerId: string, orderId: string) {
    return this.executeReturnReceiptConfirmation(orderId, sellerId);
  }

  async tryAutoConfirmSellerReturnReceipt(orderId: string): Promise<boolean> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        returnConfirmDeadline: true,
        returnShippedAt: true,
        returnConfirmedAt: true,
      },
    });
    if (
      !order ||
      order.status !== OrderStatus.RETURN_SHIPPED ||
      order.returnConfirmedAt
    ) {
      return false;
    }

    let expired = false;
    if (order.returnConfirmDeadline) {
      expired = order.returnConfirmDeadline.getTime() <= Date.now();
    } else if (order.returnShippedAt) {
      const minutes = await this.settings.getSellerReturnConfirmDeadlineMinutes();
      expired =
        Date.now() - order.returnShippedAt.getTime() >= minutes * 60 * 1000;
    }
    if (!expired) return false;

    try {
      await this.executeReturnReceiptConfirmation(orderId, 'AUTO_TIMEOUT');
      return true;
    } catch (error) {
      console.error(
        `Error auto-confirming seller return receipt for order ${orderId}:`,
        error,
      );
      return false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async autoConfirmSellerReturnReceipt(): Promise<void> {
    const now = new Date();
    const minutes = await this.settings.getSellerReturnConfirmDeadlineMinutes();
    const legacyCutoff = new Date(Date.now() - minutes * 60 * 1000);
    const candidates = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.RETURN_SHIPPED,
        returnConfirmedAt: null,
        OR: [
          { returnConfirmDeadline: { lte: now } },
          {
            returnConfirmDeadline: null,
            returnShippedAt: { lte: legacyCutoff },
          },
        ],
      },
      select: { id: true },
      take: 100,
      orderBy: { returnShippedAt: 'asc' },
    });

    for (const row of candidates) {
      await this.tryAutoConfirmSellerReturnReceipt(row.id);
    }
  }

  private async executeReturnReceiptConfirmation(
    orderId: string,
    confirmedBy: string,
  ) {
    const isAuto = confirmedBy === 'AUTO_TIMEOUT';
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          listing: {
            select: { title: true, sellerRequiresVerification: true },
          },
        },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (!isAuto && order.sellerId !== confirmedBy) {
        throw new ForbiddenException(
          'فقط فروشنده می‌تواند دریافت مرجوعی را تایید کند',
        );
      }
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException(
          'تایید مرجوعی برای سفارش معاوضه در این مرحله مجاز نیست',
        );
      }
      if (order.status !== OrderStatus.RETURN_SHIPPED) {
        throw new BadRequestException(
          'این سفارش در وضعیت مناسب برای تایید مرجوعی نیست',
        );
      }

      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.CANCELLED,
        'confirm-return-receipt',
      );

      const sellerRevenue = Number(order.sellerRevenue || 0);
      const totalAmount = Number(order.totalAmount || 0);
      const shippingCost = Number(order.shippingCost || 0);
      const verificationFee = Number(order.verificationFee || 0);
      const verificationChargedToBuyer =
        order.requiresVerification && !order.listing?.sellerRequiresVerification
          ? verificationFee
          : 0;
      const refundableToBuyer = Math.max(
        0,
        totalAmount - shippingCost - verificationChargedToBuyer,
      );

      /** یک بار مصرف: جلوگیری از دوبار کلیک / فراخوانی همزمان و بازپرداخت تکراری */
      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          ...(isAuto ? {} : { sellerId: confirmedBy }),
          status: OrderStatus.RETURN_SHIPPED,
          returnConfirmedAt: null,
        },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason: isAuto
            ? 'مرجوعی پس از پایان مهلت به‌صورت خودکار تایید و بازگشت وجه انجام شد'
            : 'مرجوعی توسط فروشنده تحویل گرفته شد و بازگشت وجه انجام شد',
          returnConfirmedAt: new Date(),
          returnConfirmedBy: confirmedBy,
        },
      });
      if (claimed.count === 0) {
        const cur = await tx.order.findUnique({
          where: { id: order.id },
          select: { returnConfirmedAt: true, status: true },
        });
        if (cur?.returnConfirmedAt || cur?.status === OrderStatus.CANCELLED) {
          throw new BadRequestException(
            'مرجوعی قبلاً تایید شده و بازگشت وجه ثبت شده است',
          );
        }
        throw new BadRequestException(
          'این سفارش در وضعیت مناسب برای تایید مرجوعی نیست',
        );
      }

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        OrderStatus.RETURN_SHIPPED,
        'FAILURE',
        { failurePenalizeUserIds: [order.sellerId] },
      );

      if (sellerRevenue > 0) {
        await this.walletService.debitOrderScopedBlocked(tx, {
          userId: order.sellerId,
          orderId: order.id,
          listingId: order.listingId,
          requestedAmount: sellerRevenue,
          referenceId: order.id,
          penaltyMeta: {
            kind: 'order-escrow',
            phase: 'seller_blocked_debit',
            debitReason: 'seller-confirmed-return',
            orderId: order.id,
            listingId: order.listingId,
            description:
              'کسر از موجودی بلوکه فروشنده پس از تایید دریافت مرجوعی',
          },
        });
      }

      if (refundableToBuyer > 0) {
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: refundableToBuyer,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: refundableToBuyer } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: refundableToBuyer,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'buyer_refund',
              refundReason: 'seller-confirmed-return',
              shippingCostExcluded: shippingCost,
              verificationFeeExcluded: verificationChargedToBuyer,
              description:
                'بازگشت وجه مرجوعی به خریدار (بدون هزینه ارسال و کارشناسی پرداخت‌شده)',
            },
          },
        });
      }

      const updated = await tx.order.findUnique({ where: { id: order.id } });
      if (!updated) throw new NotFoundException('سفارش یافت نشد');

      await tx.listing.update({
        where: { id: order.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      await tx.notification.createMany({
        data: [
          {
            userId: order.buyerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: isAuto ? 'تایید خودکار مرجوعی و بازگشت وجه' : 'مرجوعی تایید شد و وجه بازگشت',
            message: isAuto
              ? `مهلت تایید دریافت مرجوعی سفارش #${order.id.slice(-6)} به پایان رسید؛ دریافت به‌صورت خودکار تایید و مبلغ به کیف پول شما برگشت.`
              : `فروشنده دریافت مرجوعی سفارش #${order.id.slice(-6)} را تایید کرد و مبلغ به کیف پول شما برگشت.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              refundAmount: refundableToBuyer,
              autoConfirmed: isAuto,
            } as Prisma.InputJsonValue,
          },
          {
            userId: order.sellerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: isAuto ? 'تایید خودکار دریافت مرجوعی' : 'مرجوعی تایید شد',
            message: isAuto
              ? `به‌دلیل عدم تایید در مهلت مقرر، دریافت مرجوعی سفارش #${order.id.slice(-6)} به‌صورت خودکار ثبت شد و بازگشت وجه به خریدار انجام شد.`
              : `شما دریافت مرجوعی سفارش #${order.id.slice(-6)} را تایید کردید و پرونده بسته شد.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.CANCELLED,
              autoConfirmed: isAuto,
            } as Prisma.InputJsonValue,
          },
        ],
      });

      return {
        success: true,
        message: isAuto
          ? 'مرجوعی به‌صورت خودکار تایید و بازگشت وجه انجام شد'
          : 'مرجوعی تایید شد و بازگشت وجه انجام شد',
        order: updated,
      };
    });
  }


  private async ensureReturnConfirmDeadline(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        returnConfirmDeadline: true,
        returnShippedAt: true,
      },
    });
    if (!order || order.status !== OrderStatus.RETURN_SHIPPED) return;
    if (order.returnConfirmDeadline) return;

    const minutes = await this.settings.getSellerReturnConfirmDeadlineMinutes();
    const base = order.returnShippedAt ?? new Date();
    const returnConfirmDeadline = new Date(
      base.getTime() + minutes * 60 * 1000,
    );
    await this.prisma.order.update({
      where: { id: orderId },
      data: { returnConfirmDeadline },
    });
  }

  async confirmOrder(userId: string, orderId: string) {
    const before = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        type: true,
        buyerConfirmedDelivery: true,
        sellerConfirmedDelivery: true,
        exchangeHubInspection: true,
      },
    });

    const order = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId } });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.type === OrderType.EXCHANGE) {
        const isBuyer = order.buyerId === userId;
        const isSeller = order.sellerId === userId;
        if (!isBuyer && !isSeller) {
          throw new BadRequestException('شما طرفین این سفارش نیستید');
        }
        if (order.status === OrderStatus.COMPLETED) {
          throw new BadRequestException('این سفارش قبلاً تسویه شده است');
        }
        const inspection =
          (order.exchangeHubInspection as Record<string, unknown> | null) ??
          null;
        const isReturnBothFlow =
          inspection?.['resolution'] === 'RETURN_BOTH_TO_SENDERS' &&
          (order.status === OrderStatus.CANCELLED ||
            order.status === OrderStatus.REJECTED_AT_HUB);
        const refundableAlreadyReleased = Boolean(
          inspection?.['refundsReleasedAt'],
        );

        if (!isReturnBothFlow) {
          this.stateMachine.assertTransition(
            order.status,
            OrderStatus.COMPLETED,
            'confirm-order-exchange',
          );
        }

        if (isReturnBothFlow) {
          if (refundableAlreadyReleased) {
            throw new BadRequestException(
              'بازگشت وجه این مرجوعی قبلاً انجام شده است',
            );
          }

          if (isBuyer) {
            if (!order.hubToBuyerTrackingCode?.trim()) {
              throw new BadRequestException(
                'تا زمان ثبت کد رهگیری مرجوعی کالای شما، امکان تایید دریافت وجود ندارد.',
              );
            }
            if (order.buyerConfirmedDelivery) {
              throw new BadRequestException(
                'شما قبلاً دریافت کالای مرجوعی خود را تایید کرده‌اید',
              );
            }
          }
          if (isSeller) {
            if (!order.hubToSellerTrackingCode?.trim()) {
              throw new BadRequestException(
                'تا زمان ثبت کد رهگیری مرجوعی کالای شما، امکان تایید دریافت وجود ندارد.',
              );
            }
            if (order.sellerConfirmedDelivery) {
              throw new BadRequestException(
                'شما قبلاً دریافت کالای مرجوعی خود را تایید کرده‌اید',
              );
            }
          }

          const updateData: Prisma.OrderUpdateInput = {};
          if (isBuyer && !order.buyerConfirmedDelivery) {
            updateData.buyerConfirmedDelivery = true;
          }
          if (isSeller && !order.sellerConfirmedDelivery) {
            updateData.sellerConfirmedDelivery = true;
          }
          const afterAck = await tx.order.update({
            where: { id: orderId },
            data: updateData,
          });

          const bothConfirmed =
            (afterAck.buyerConfirmedDelivery || isBuyer) &&
            (afterAck.sellerConfirmedDelivery || isSeller);
          if (!bothConfirmed) {
            const mergedInspection = {
              ...inspection,
              buyerReturnReceived: Boolean(
                afterAck.buyerConfirmedDelivery || isBuyer,
              ),
              sellerReturnReceived: Boolean(
                afterAck.sellerConfirmedDelivery || isSeller,
              ),
              awaitingReturnConfirmations: true,
            };
            return tx.order.update({
              where: { id: orderId },
              data: {
                exchangeHubInspection:
                  mergedInspection as Prisma.InputJsonValue,
              },
            });
          }

          const exchangeOffer = order.exchangeOfferId
            ? await tx.exchangeOffer.findUnique({
                where: { id: order.exchangeOfferId },
                select: { extraPayment: true, isPayerMe: true },
              })
            : null;
          const verificationFee = Number(order.verificationFee || 0);
          const extra = Number(exchangeOffer?.extraPayment || 0);
          const buyerShare =
            verificationFee + (exchangeOffer?.isPayerMe ? extra : 0);
          const sellerShare =
            verificationFee + (!exchangeOffer?.isPayerMe ? extra : 0);
          const buyerRefundable = Math.max(0, buyerShare - verificationFee);
          const sellerRefundable = Math.max(0, sellerShare - verificationFee);

          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            listingId: order.listingId,
            orderId: order.id,
            isPayerMe: Boolean(exchangeOffer?.isPayerMe),
            buyerRefundable,
            sellerRefundable,
          });

          const mergedInspection = {
            ...inspection,
            buyerReturnReceived: true,
            sellerReturnReceived: true,
            awaitingReturnConfirmations: false,
            refundsReleasedAt: new Date().toISOString(),
          };
          return tx.order.update({
            where: { id: orderId },
            data: {
              exchangeHubInspection: mergedInspection as Prisma.InputJsonValue,
              returnConfirmedAt: new Date(),
              returnConfirmedBy: 'BOTH_PARTIES',
              cancelReason: [
                order.cancelReason ?? 'مرجوعی دوطرفه معاوضه',
                'دریافت مرجوعی توسط هر دو طرف تایید شد و سهم پرداختی (بدون هزینه کارشناسی) آزاد شد.',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          });
        }

        const hubShipped =
          order.status === OrderStatus.SHIPPED_TO_BUYER ||
          order.status === OrderStatus.SHIPPED ||
          order.status === OrderStatus.DELIVERED;
        if (!hubShipped) {
          throw new BadRequestException(
            'هنوز مرحله ارسال کالا از هاب به مقصد نهایی تکمیل نشده؛ امکان تایید دریافت نیست.',
          );
        }
        if (isBuyer) {
          if (!order.hubToBuyerTrackingCode?.trim()) {
            throw new BadRequestException(
              'تا زمان ثبت کد رهگیری ارسال کالای شما از هاب، امکان تایید دریافت وجود ندارد.',
            );
          }
          if (order.buyerConfirmedDelivery) {
            throw new BadRequestException(
              'شما قبلاً دریافت کالای خود را تایید کرده‌اید',
            );
          }
        }
        if (isSeller) {
          if (!order.hubToSellerTrackingCode?.trim()) {
            throw new BadRequestException(
              'تا زمان ثبت کد رهگیری ارسال کالای شما از هاب، امکان تایید دریافت وجود ندارد.',
            );
          }
          if (order.sellerConfirmedDelivery) {
            throw new BadRequestException(
              'شما قبلاً دریافت کالای خود را تایید کرده‌اید',
            );
          }
        }

        const updateData: Prisma.OrderUpdateInput = {};
        if (isBuyer && !order.buyerConfirmedDelivery) {
          updateData.buyerConfirmedDelivery = true;
        }
        if (isSeller && !order.sellerConfirmedDelivery) {
          updateData.sellerConfirmedDelivery = true;
        }
        const afterAck = await tx.order.update({
          where: { id: orderId },
          data: updateData,
        });

        const bothConfirmed =
          (afterAck.buyerConfirmedDelivery || isBuyer) &&
          (afterAck.sellerConfirmedDelivery || isSeller);
        if (!bothConfirmed) {
          return afterAck;
        }

        // در معاوضه، برای جلوگیری از دوبار واریز، فقط همان مبالغی را آزاد می‌کنیم
        // که واقعاً هنوز در کیف پول کاربران در حالت بلوکه مانده‌اند.
        const [sellerRelease, buyerRelease] = await Promise.all([
          this.walletService.getOrderScopedBlockedAmount(tx, {
            userId: order.sellerId,
            orderId: order.id,
            listingId: order.listingId,
          }),
          this.walletService.getOrderScopedBlockedAmount(tx, {
            userId: order.buyerId,
            orderId: order.id,
            listingId: order.listingId,
          }),
        ]);

        if (sellerRelease > 0) {
          await this.walletService.releaseEscrow(
            order.sellerId,
            sellerRelease,
            order.listingId,
            tx,
            { orderId: order.id },
          );
        }
        if (buyerRelease > 0) {
          await this.walletService.releaseEscrow(
            order.buyerId,
            buyerRelease,
            order.listingId,
            tx,
            { orderId: order.id },
          );
        }

        const prevExchangeStatus = order.status;
        const completedExchange = await tx.order.update({
          where: { id: orderId },
          data: enrichOrderUpdateForCompletion({
            status: OrderStatus.COMPLETED,
          }),
        });
        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            tradeReputationAt: order.tradeReputationAt,
          },
          prevExchangeStatus,
          'SUCCESS',
        );
        return completedExchange;
      }

      if (order.buyerId !== userId)
        throw new BadRequestException('شما خریدار این سفارش نیستید');

      // اجازه نمیدیم سفارشی که قبلا تکمیل شده دوباره تایید بشه
      if (order.status === OrderStatus.COMPLETED)
        throw new BadRequestException('این سفارش قبلاً تسویه شده است');
      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.COMPLETED,
        'confirm-order',
      );

      const sellerRelease = await this.walletService.resolveOrderScopedCap(tx, {
        userId: order.sellerId,
        orderId: order.id,
        listingId: order.listingId,
        requestedAmount: Number(order.sellerRevenue),
      });
      if (sellerRelease > 0) {
        await this.walletService.releaseEscrow(
          order.sellerId,
          sellerRelease,
          order.listingId,
          tx,
          { orderId: order.id },
        );
      }

      // 🎯 تغییر وضعیت به تکمیل شده (تسویه نهایی)
      const prevDirectStatus = order.status;
      const completedDirect = await tx.order.update({
        where: { id: orderId },
        data: enrichOrderUpdateForCompletion({
          status: OrderStatus.COMPLETED,
        }),
      });

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        prevDirectStatus,
        'SUCCESS',
      );
      return completedDirect;
    });

    if (
      before?.status !== OrderStatus.COMPLETED &&
      order.status === OrderStatus.COMPLETED
    ) {
      await this.operationalNotify
        .notifyOrderCompleted({
          orderId: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          listingId: order.listingId,
          orderType: order.type,
        })
        .catch(() => undefined);
    } else if (order.type === OrderType.EXCHANGE && before) {
      const beforeInspection =
        (before.exchangeHubInspection as Record<string, unknown> | null) ?? {};
      const afterInspection =
        (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
      const isReturnBothFlow =
        afterInspection['resolution'] === 'RETURN_BOTH_TO_SENDERS' &&
        (order.status === OrderStatus.CANCELLED ||
          order.status === OrderStatus.REJECTED_AT_HUB);
      const refundsJustReleased =
        isReturnBothFlow &&
        !beforeInspection['refundsReleasedAt'] &&
        Boolean(afterInspection['refundsReleasedAt']);

      if (refundsJustReleased) {
        await this.operationalNotify
          .notifyExchangeAutoReturnEscrowReleased({
            orderId: order.id,
            listingId: order.listingId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
          })
          .catch(() => undefined);
      } else if (
        order.status !== OrderStatus.COMPLETED &&
        (isReturnBothFlow
          ? afterInspection['awaitingReturnConfirmations'] === true
          : true)
      ) {
        const buyerJustConfirmed =
          !before.buyerConfirmedDelivery && order.buyerConfirmedDelivery;
        const sellerJustConfirmed =
          !before.sellerConfirmedDelivery && order.sellerConfirmedDelivery;
        if (buyerJustConfirmed || sellerJustConfirmed) {
          const confirmedBy = buyerJustConfirmed ? 'BUYER' : 'SELLER';
          const legParams = {
            orderId: order.id,
            listingId: order.listingId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            confirmedBy,
          } as const;
          if (isReturnBothFlow) {
            await this.operationalNotify
              .notifyExchangeReturnLegConfirmed(legParams)
              .catch(() => undefined);
          } else {
            await this.operationalNotify
              .notifyExchangeLegDeliveryConfirmed({
                ...legParams,
                status: order.status,
              })
              .catch(() => undefined);
          }
        }
      }
    }

    return order;
  }
  // 7. ثبت شکایت (Dispute) ✅ اصلاح شده برای حل ارور includes
  // =================================================================
  async disputeOrder(
    buyerId: string,
    orderId: string,
    reason: string,
    videoPath?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: { listing: true },
      });

      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (order.buyerId !== buyerId)
        throw new BadRequestException('شما خریدار نیستید');
      if (order.type === OrderType.EXCHANGE) {
        throw new BadRequestException(
          'برای معاملات معاوضه امکان ثبت شکایت در این مرحله وجود ندارد',
        );
      }

      // ✅ اصلاح شده: استفاده از شرط صریح به جای includes
      if (
        order.status !== OrderStatus.SHIPPED &&
        order.status !== OrderStatus.DELIVERED &&
        order.status !== OrderStatus.SHIPPED_TO_BUYER
      ) {
        throw new BadRequestException('وضعیت سفارش برای شکایت مناسب نیست');
      }

      // اگر سفارش از مسیر کارشناسی با موفقیت عبور کرده باشد، ثبت شکایت در این فاز مجاز نیست.
      const wasInspectedAndApproved =
        Boolean(
          order.requiresVerification ||
          order.listing?.sellerRequiresVerification,
        ) &&
        [
          OrderStatus.SHIPPED_TO_BUYER,
          OrderStatus.SHIPPED,
          OrderStatus.DELIVERED,
        ].includes(order.status);
      if (wasInspectedAndApproved) {
        throw new BadRequestException(
          'برای سفارش کارشناسی‌شده و ارسال‌شده، امکان ثبت شکایت وجود ندارد',
        );
      }

      this.stateMachine.assertTransition(
        order.status,
        OrderStatus.DISPUTED,
        'dispute-order',
      );
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: OrderStatus.DISPUTED,
          unboxingVideo: videoPath,
          disputeReason: reason,
          disputedAt: new Date(),
        },
      });

      const apiUrl = this.appSettings.getApiUrl();
      const videoLink = videoPath
        ? `\n🎥 ویدیو: ${apiUrl}/uploads/orders/${videoPath}`
        : '';

      const ticketMessage = formatTicketMessageBody(
        [
          'اعلام مغایرت سفارش شما ثبت شد و برای کارشناسی ارسال گردید.',
          `کالا: «${order.listing.title}»`,
          `شرح مغایرت: ${reason.trim()}`,
          videoPath ? `ویدیوی پیوست: ${apiUrl}/uploads/orders/${videoPath}` : '',
        ].filter((line): line is string => Boolean(line)),
      );

      const createdTicket = await tx.ticket.create({
        data: {
          userId: buyerId,
          subject: buildOrderTicketSubject('شکایت — مغایرت کالا', order.id),
          status: 'OPEN',
          messages: {
            create: { senderRole: 'USER', message: ticketMessage },
          },
        },
        select: { id: true },
      });

      await tx.notification.createMany({
        data: [
          {
            userId: buyerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'شکایت شما ثبت شد',
            message: `شکایت سفارش #${order.id.slice(-6)} ثبت شد و برای پشتیبانی ارسال گردید.`,
            meta: {
              orderId: order.id,
              ticketId: createdTicket.id,
              status: OrderStatus.DISPUTED,
            } as Prisma.InputJsonValue,
          },
          {
            userId: order.sellerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'برای سفارش شما شکایت ثبت شد',
            message: `خریدار برای سفارش #${order.id.slice(-6)} شکایت ثبت کرده است.`,
            meta: {
              orderId: order.id,
              status: OrderStatus.DISPUTED,
            } as Prisma.InputJsonValue,
          },
        ],
      });

      await this.listingCommand.rejectAfterTradeFailure(tx, {
        listingId: order.listingId,
        sellerId: order.sellerId,
        listingTitle: order.listing?.title ?? 'کالا',
        rejectionReason: `شکایت خریدار: ${reason.trim()}`,
        source: 'dispute',
        orderId: order.id,
      });

      return {
        success: true,
        message: 'شکایت شما ثبت شد و مبلغ مسدود ماند.',
        ticketId: createdTicket.id,
      };
    });
  }

  /**
   * پس از لغو معامله به‌دلیل عدم ارسال در مهلت، آگهی نباید خودکار منتشر بماند.
   * وضعیت REJECTED می‌شود تا فروشنده در صورت تمایل دوباره ویرایش و ثبت کند.
   */
}
