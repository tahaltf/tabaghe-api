import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AdminEscrowAction,
  FinalizeExchangeHubInspectionDto,
  ResolveOrderEscrowDto,
  SetExchangeHubReceiptDto,
  SetHubShippingCodesDto,
  SetParticipantShippingDto,
} from '../dto/admin-order.dto';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import {
  OrderReputationService,
  TRADE_REPUTATION_PENALTY_DELTA,
} from '../../orders/order-reputation.service';
import { WalletService } from '../../wallet/wallet.service';
import { OrdersService } from '../../orders/orders.service';
import { enrichOrderUpdateForCompletion } from '../../orders/order-lifecycle.util';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../common/ticket-message.util';

@Injectable()
export class AdminOrdersCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly ordersService: OrdersService,
    private readonly listingCommand: ListingCommandService,
  ) {}

  repairBuyerRefundForCancelledOrder(orderId: string) {
    return this.walletService.repairMissingDirectCancelRefund(orderId);
  }

  async updateStatus(
    id: string,
    status: OrderStatus,
    note?: string,
    rejectedReturnTrackingCode?: string,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        type: true,
        listingId: true,
        totalAmount: true,
        sellerRevenue: true,
        returnTrackingCode: true,
        trackingCode: true,
        sellerTrackingCode: true,
        packagingVideo: true,
        buyerPackagingVideo: true,
        tradeReputationAt: true,
        listing: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
          },
        },
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');

    if (
      existing.type === 'EXCHANGE' &&
      existing.status === OrderStatus.CHECKING_AT_HUB &&
      (status === OrderStatus.VERIFIED_AT_HUB ||
        status === OrderStatus.REJECTED_AT_HUB)
    ) {
      throw new BadRequestException(
        'برای سفارش معاوضه، نتیجه کارشناسی هر دو کالا را از بخش «ثبت نتیجه کارشناسی معاوضه» در پنل ثبت کنید.',
      );
    }

    if (status === OrderStatus.REJECTED_AT_HUB) {
      const normalizedNote = note?.trim();
      if (!normalizedNote) {
        throw new BadRequestException('برای رد کارشناسی، ثبت توضیح اجباری است');
      }

      const apiUrl = this.appSettings.getApiUrl().replace(/\/$/, '');
      const listingUrl = `${apiUrl}/listing/${existing.listing.id}`;
      const packagingVideoUrl = existing.packagingVideo
        ? `${apiUrl}/uploads/orders/videos/${existing.packagingVideo}`
        : null;
      const buyerPackagingVideoUrl = existing.buyerPackagingVideo
        ? `${apiUrl}/uploads/orders/videos/${existing.buyerPackagingVideo}`
        : null;

      const hubRejectCopy = this.buildDirectHubInspectionRejectionMessaging({
        listingTitle: existing.listing.title.trim(),
        orderShortId: id.slice(-6).toUpperCase(),
        normalizedNote,
        listingUrl,
        packagingVideoUrl,
        buyerPackagingVideoUrl,
        trackingCodes: {
          seller: existing.trackingCode ?? null,
          exchangePeer: existing.sellerTrackingCode ?? null,
        },
        isExchangeListing: existing.type === 'EXCHANGE',
      });

      return this.prisma.$transaction(async (tx) => {
        const updatedOrder = await tx.order.update({
          where: { id },
          data: {
            status: OrderStatus.REJECTED_AT_HUB,
            cancelReason: normalizedNote,
          },
        });

        const sellerTicket = await tx.ticket.create({
          data: {
            userId: existing.sellerId,
            subject: buildOrderTicketSubject('رد کارشناسی هاب', id),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: hubRejectCopy.sellerTicketBody,
              },
            },
          },
          select: { id: true },
        });

        const buyerTicket = await tx.ticket.create({
          data: {
            userId: existing.buyerId,
            subject: buildOrderTicketSubject('رد کارشناسی — بازپرداخت', id),
            status: 'OPEN',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: hubRejectCopy.buyerTicketBody,
              },
            },
          },
          select: { id: true },
        });

        await tx.notification.createMany({
          data: [
            {
              userId: existing.sellerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت رسمی؛ رد کارشناسی طبقه',
              message: hubRejectCopy.sellerTicketNotifyPreview,
              meta: {
                orderId: id,
                ticketId: sellerTicket.id,
                audience: 'SELLER',
              } as Prisma.InputJsonValue,
            },
            {
              userId: existing.buyerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت رسمی؛ معذرت و توضیح رد کارشناسی',
              message: hubRejectCopy.buyerTicketNotifyPreview,
              meta: {
                orderId: id,
                ticketId: buyerTicket.id,
                audience: 'BUYER',
              } as Prisma.InputJsonValue,
            },
          ],
        });

        await this.notifyHubInspectionRejectedPartiesPush(
          existing.buyerId,
          existing.sellerId,
          id,
          hubRejectCopy.buyerPushSummary,
          hubRejectCopy.sellerPushSummary,
        );

        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: existing.listingId,
          sellerId: existing.sellerId,
          listingTitle: existing.listing.title,
          rejectionReason: `رد کارشناسی در طبقه: ${normalizedNote}`,
          source: 'hub-inspection',
          orderId: id,
        });

        return updatedOrder;
      });
    }

    if (status === OrderStatus.CANCELLED) {
      const normalizedNote = note?.trim();
      const normalizedReturnTrackingCode = rejectedReturnTrackingCode?.trim();
      if (
        existing.status === OrderStatus.REJECTED_AT_HUB &&
        (!normalizedReturnTrackingCode ||
          normalizedReturnTrackingCode.length < 3)
      ) {
        throw new BadRequestException(
          'برای لغو پس از رد کارشناسی، کد رهگیری برگشت به فروشنده اجباری است',
        );
      }

      return this.prisma.$transaction(async (tx) => {
        const totalAmount = Number(existing.totalAmount || 0);
        const sellerRevenue = Number(existing.sellerRevenue || 0);

        if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: existing.sellerId },
            create: {
              userId: existing.sellerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: sellerRevenue } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: existing.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: existing.id,
              meta: {
                kind: 'order-escrow',
                phase: 'seller_blocked_debit',
                debitReason: 'admin-status-cancelled',
                adminNote: normalizedNote ?? null,
                description:
                  'کسر از موجودی بلوکه فروشنده به‌دلیل لغو سفارش و بازگشت وجه خریدار',
              },
            },
          });
        }

        if (totalAmount > 0) {
          await tx.wallet.upsert({
            where: { userId: existing.buyerId },
            create: {
              userId: existing.buyerId,
              balanceAvailable: totalAmount,
              balanceBlocked: 0,
            },
            update: { balanceAvailable: { increment: totalAmount } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: existing.buyerId } },
              amount: totalAmount,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: existing.id,
              meta: {
                refundReason: 'admin-status-cancelled',
                adminNote: normalizedNote ?? null,
                ...(normalizedReturnTrackingCode
                  ? { returnTrackingCode: normalizedReturnTrackingCode }
                  : {}),
              },
            },
          });
        }

        const updatedOrder = await tx.order.update({
          where: { id: existing.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: normalizedNote ?? 'لغو دستی سفارش توسط ادمین',
            returnTrackingCode:
              existing.status === OrderStatus.REJECTED_AT_HUB
                ? normalizedReturnTrackingCode
                : existing.returnTrackingCode,
            returnShippedAt:
              existing.status === OrderStatus.REJECTED_AT_HUB
                ? new Date()
                : undefined,
          },
        });

        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: existing.id,
            buyerId: existing.buyerId,
            sellerId: existing.sellerId,
            tradeReputationAt: existing.tradeReputationAt,
          },
          existing.status,
          'FAILURE',
        );

        await tx.listing.update({
          where: { id: existing.listingId },
          data: { status: ListingStatus.APPROVED },
        });

        const buyerTicketMessage = formatTicketMessageBody([
          `سفارش «${existing.listing.title}» لغو شد.`,
          `علت: ${normalizedNote || 'لغو سفارش توسط پشتیبانی'}`,
          `مبلغ ${totalAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
        ]);
        const buyerTicket = await tx.ticket.create({
          data: {
            userId: existing.buyerId,
            subject: buildOrderTicketSubject('لغو سفارش — بازگشت وجه', existing.id),
            status: 'ANSWERED',
            messages: {
              create: {
                senderRole: UserRole.ADMIN,
                message: buyerTicketMessage,
              },
            },
          },
          select: { id: true },
        });

        await tx.notification.create({
          data: {
            userId: existing.buyerId,
            type: NotificationType.TICKET_REPLY,
            title: 'تیکت لغو سفارش ثبت شد',
            message: `برای سفارش #${existing.id.slice(-6)} تیکت ثبت شد و مبلغ به کیف پول شما برگشت.`,
            meta: {
              orderId: existing.id,
              ticketId: buyerTicket.id,
            } as Prisma.InputJsonValue,
          },
        });

        await this.notifyParties(
          existing.buyerId,
          existing.sellerId,
          existing.id,
          OrderStatus.CANCELLED,
          normalizedNote ?? 'لغو سفارش و بازگشت وجه انجام شد',
        );

        return updatedOrder;
      });
    }

    const order = await this.prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id },
        data: enrichOrderUpdateForCompletion({ status }),
      });
      // مسیر CANCELLED در بالا برگردانده شده؛ اینجا فقط سایر انتقال‌ها (از جمله COMPLETED)
      if (status === OrderStatus.COMPLETED) {
        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: existing.id,
            buyerId: existing.buyerId,
            sellerId: existing.sellerId,
            tradeReputationAt: existing.tradeReputationAt,
          },
          existing.status,
          'SUCCESS',
        );
      }
      return o;
    });
    await this.ordersService.ensureBuyerConfirmDeadline(id);
    await this.notifyParties(
      existing.buyerId,
      existing.sellerId,
      id,
      status,
      note,
    );
    return order;
  }

  async setHubShippingCodes(id: string, dto: SetHubShippingCodesDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        exchangeOfferId: true,
        verificationFee: true,
        status: true,
        hubToBuyerTrackingCode: true,
        hubToSellerTrackingCode: true,
        exchangeHubInspection: true,
        buyerConfirmDeadline: true,
        cancelReason: true,
        totalAmount: true,
        sellerRevenue: true,
        tradeReputationAt: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    const inspection =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ??
      null;
    const isDirectHubReturnFlow =
      (existing.type === 'DIRECT' || existing.type === 'AUCTION') &&
      existing.status === OrderStatus.REJECTED_AT_HUB;
    const isExchangeReturnFlow =
      existing.type === 'EXCHANGE' &&
      (existing.status === OrderStatus.REJECTED_AT_HUB ||
        existing.status === OrderStatus.CANCELLED) &&
      inspection?.['resolution'] === 'RETURN_BOTH_TO_SENDERS';
    const canShipNormalFlow =
      existing.status === OrderStatus.VERIFIED_AT_HUB ||
      existing.status === OrderStatus.SHIPPED_TO_BUYER;
    if (!canShipNormalFlow && !isExchangeReturnFlow && !isDirectHubReturnFlow) {
      throw new BadRequestException(
        'این سفارش در وضعیت مناسب برای ارسال از هاب نیست',
      );
    }

    if (isDirectHubReturnFlow) {
      const sellerReturnCode = (dto.hubToSellerTrackingCode ?? '').trim();
      if (sellerReturnCode.length < 3) {
        throw new BadRequestException(
          'کد رهگیری مرجوع از هاب به فروشنده الزامی است',
        );
      }
    }

    const nextBuyerTracking =
      dto.hubToBuyerTrackingCode ?? existing.hubToBuyerTrackingCode;
    const nextSellerTracking =
      existing.type === 'EXCHANGE' || isDirectHubReturnFlow
        ? (dto.hubToSellerTrackingCode ?? existing.hubToSellerTrackingCode)
        : existing.hubToSellerTrackingCode;
    const returnShipmentCompleted = isDirectHubReturnFlow
      ? Boolean(nextSellerTracking)
      : isExchangeReturnFlow
        ? Boolean(nextBuyerTracking && nextSellerTracking)
        : false;
    const mergedInspection = isExchangeReturnFlow
      ? {
          ...inspection,
          returnBuyerShipped: Boolean(nextBuyerTracking),
          returnSellerShipped: Boolean(nextSellerTracking),
          returnShipmentCompletedAt: returnShipmentCompleted
            ? (inspection?.['returnShipmentCompletedAt'] ??
              new Date().toISOString())
            : (inspection?.['returnShipmentCompletedAt'] ?? null),
        }
      : null;
    const nextStatus =
      isExchangeReturnFlow || isDirectHubReturnFlow
        ? returnShipmentCompleted
          ? OrderStatus.CANCELLED
          : OrderStatus.REJECTED_AT_HUB
        : OrderStatus.SHIPPED_TO_BUYER;

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        hubToBuyerTrackingCode: isDirectHubReturnFlow
          ? existing.hubToBuyerTrackingCode
          : dto.hubToBuyerTrackingCode,
        hubToSellerTrackingCode:
          existing.type === 'EXCHANGE' || isDirectHubReturnFlow
            ? dto.hubToSellerTrackingCode
            : undefined,
        status: nextStatus,
        ...(isDirectHubReturnFlow && returnShipmentCompleted
          ? {
              returnConfirmedAt: new Date(),
              cancelReason: [
                existing.cancelReason,
                `کد رهگیری مرجوع از هاب به فروشنده: ${nextSellerTracking}`,
                dto.note ? `توضیح: ${dto.note}` : null,
              ]
                .filter(Boolean)
                .join('\n'),
            }
          : {}),
        ...(mergedInspection
          ? { exchangeHubInspection: mergedInspection as Prisma.InputJsonValue }
          : {}),
        ...(!isExchangeReturnFlow &&
        nextStatus === OrderStatus.SHIPPED_TO_BUYER &&
        !existing.buyerConfirmDeadline
          ? {
              buyerConfirmDeadline:
                await this.ordersService.computeBuyerConfirmDeadlineNow(),
            }
          : {}),
      },
    });

    const buyerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله خروجی مربوط به شما از هاب ارسال شد و کد رهگیری ثبت گردید.'
        : 'مرسوله از هاب به مقصد شما ارسال شد و کد رهگیری ثبت گردید.');
    const sellerNote =
      dto.note ??
      (existing.type === 'EXCHANGE'
        ? 'مرسوله خروجی مربوط به شما از هاب ارسال شد و کد رهگیری ثبت گردید.'
        : 'مرسوله از هاب برای خریدار ارسال شد و کد رهگیری ثبت گردید.');

    const notifications: Prisma.NotificationCreateManyInput[] = [];
    if (existing.type === 'EXCHANGE') {
      const hasBuyerLegUpdate = Boolean(dto.hubToBuyerTrackingCode);
      const hasSellerLegUpdate = Boolean(dto.hubToSellerTrackingCode);
      const statusForNotification = nextStatus;
      const titleForNotification = isExchangeReturnFlow
        ? returnShipmentCompleted
          ? 'مرجوعی از هاب ثبت شد'
          : 'ثبت مسیر مرجوعی از هاب'
        : 'وضعیت سفارش تغییر کرد';
      const messageForBuyer = isExchangeReturnFlow
        ? `مرسوله مرجوعی مربوط به شما از هاب ثبت شد. ${buyerNote}`
        : `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${buyerNote}`;
      const messageForSeller = isExchangeReturnFlow
        ? `مرسوله مرجوعی مربوط به شما از هاب ثبت شد. ${sellerNote}`
        : `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${sellerNote}`;
      if (hasBuyerLegUpdate) {
        notifications.push({
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: titleForNotification,
          message: messageForBuyer,
          meta: {
            orderId: id,
            status: statusForNotification,
            note: buyerNote,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        });
      }
      if (hasSellerLegUpdate) {
        notifications.push({
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: titleForNotification,
          message: messageForSeller,
          meta: {
            orderId: id,
            status: statusForNotification,
            note: sellerNote,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        });
      }
      // اگر هر دو رهگیری با هم ثبت شدند، هر دو نوتیفیکیشن ساخته می‌شود.
    } else if (isDirectHubReturnFlow) {
      const returnNote =
        dto.note ??
        'کالا از هاب به آدرس فروشنده مرجوع شد و کد رهگیری ثبت گردید.';
      notifications.push(
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'مرجوعی از هاب ثبت شد',
          message: `مرسوله شما از هاب به آدرس شما مرجوع شد. ${returnNote}`,
          meta: {
            orderId: id,
            status: nextStatus,
            note: returnNote,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'مرجوعی از هاب و بازگشت وجه',
          message: `کالا از هاب به فروشنده مرجوع شد؛ مبلغ پرداختی به کیف پول شما بازگشت داده می‌شود. ${returnNote}`,
          meta: {
            orderId: id,
            status: nextStatus,
            note: returnNote,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
      );
    } else {
      notifications.push(
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'وضعیت سفارش تغییر کرد',
          message: `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${buyerNote}`,
          meta: {
            orderId: id,
            status: OrderStatus.SHIPPED_TO_BUYER,
            note: buyerNote,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'وضعیت سفارش تغییر کرد',
          message: `وضعیت سفارش به «ارسال به خریدار» تغییر یافت. توضیح: ${sellerNote}`,
          meta: {
            orderId: id,
            status: OrderStatus.SHIPPED_TO_BUYER,
            note: sellerNote,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
      );
    }

    if (notifications.length > 0) {
      await this.prisma.notification.createMany({ data: notifications });
    }

    // در مرجوعی معاوضه، به‌محض اینکه هر دو کد رهگیری برگشت از هاب ثبت شد،
    // سرکِ پرداخت‌شده باید فوراً از بلوکه طرف مقابل آزاد و به پرداخت‌کننده برگردد
    // (بدون هزینه کارشناسی). این کار قبلاً به تایید دریافت/تایمر موکول می‌شد.
    if (isExchangeReturnFlow && nextBuyerTracking && nextSellerTracking) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.order.findUnique({
          where: { id },
          select: {
            id: true,
            type: true,
            buyerId: true,
            sellerId: true,
            listingId: true,
            exchangeOfferId: true,
            verificationFee: true,
            exchangeHubInspection: true,
          },
        });
        if (!locked || locked.type !== 'EXCHANGE') return;

        const insp =
          (locked.exchangeHubInspection as Record<string, unknown> | null) ??
          {};
        if (
          insp['resolution'] !== 'RETURN_BOTH_TO_SENDERS' ||
          typeof insp['refundsReleasedAt'] === 'string'
        ) {
          return;
        }

        const offer = locked.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: locked.exchangeOfferId },
              select: { extraPayment: true, isPayerMe: true },
            })
          : null;
        const verificationFee = Number(locked.verificationFee || 0);
        const extra = Number(offer?.extraPayment || 0);
        const buyerShare = verificationFee + (offer?.isPayerMe ? extra : 0);
        const sellerShare = verificationFee + (!offer?.isPayerMe ? extra : 0);
        const buyerRefundable = Math.max(0, buyerShare - verificationFee);
        const sellerRefundable = Math.max(0, sellerShare - verificationFee);

        if (offer?.isPayerMe && buyerRefundable > 0) {
          // پرداخت‌کننده خریدار بوده؛ پول در بلوکه فروشنده است.
          await tx.wallet.upsert({
            where: { userId: locked.sellerId },
            create: {
              userId: locked.sellerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: buyerRefundable } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: locked.sellerId } },
              amount: buyerRefundable,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: locked.id,
              meta: {
                kind: 'exchange-return-refund',
                orderId: locked.id,
                listingId: locked.listingId,
                description:
                  'مرجوعی معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت سرک',
              },
            },
          });
          await tx.wallet.upsert({
            where: { userId: locked.buyerId },
            create: {
              userId: locked.buyerId,
              balanceAvailable: buyerRefundable,
              balanceBlocked: 0,
            },
            update: { balanceAvailable: { increment: buyerRefundable } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: locked.buyerId } },
              amount: buyerRefundable,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: locked.id,
              meta: {
                kind: 'exchange-return-refund',
                orderId: locked.id,
                listingId: locked.listingId,
                description:
                  'مرجوعی معاوضه: بازگشت سرک پرداختی به پرداخت‌کننده (بدون کارشناسی)',
              },
            },
          });
        }

        if (!offer?.isPayerMe && sellerRefundable > 0) {
          // پرداخت‌کننده فروشنده بوده؛ پول در بلوکه خریدار است.
          await tx.wallet.upsert({
            where: { userId: locked.buyerId },
            create: {
              userId: locked.buyerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: sellerRefundable } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: locked.buyerId } },
              amount: sellerRefundable,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: locked.id,
              meta: {
                kind: 'exchange-return-refund',
                orderId: locked.id,
                listingId: locked.listingId,
                description:
                  'مرجوعی معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت سرک',
              },
            },
          });
          await tx.wallet.upsert({
            where: { userId: locked.sellerId },
            create: {
              userId: locked.sellerId,
              balanceAvailable: sellerRefundable,
              balanceBlocked: 0,
            },
            update: { balanceAvailable: { increment: sellerRefundable } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: locked.sellerId } },
              amount: sellerRefundable,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: locked.id,
              meta: {
                kind: 'exchange-return-refund',
                orderId: locked.id,
                listingId: locked.listingId,
                description:
                  'مرجوعی معاوضه: بازگشت سرک پرداختی به پرداخت‌کننده (بدون کارشناسی)',
              },
            },
          });
        }

        await tx.order.update({
          where: { id: locked.id },
          data: {
            exchangeHubInspection: {
              ...insp,
              refundsReleasedAt: new Date().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      });
    }

    if (isDirectHubReturnFlow && returnShipmentCompleted) {
      await this.prisma.$transaction(async (tx) => {
        const locked = await tx.order.findUnique({
          where: { id },
          select: {
            id: true,
            type: true,
            status: true,
            buyerId: true,
            sellerId: true,
            listingId: true,
            totalAmount: true,
            sellerRevenue: true,
            cancelReason: true,
            tradeReputationAt: true,
          },
        });
        if (
          !locked ||
          locked.type === 'EXCHANGE' ||
          locked.status !== OrderStatus.CANCELLED
        ) {
          return;
        }

        await this.walletService.refundDirectOrderEscrowOnCancel(tx, {
          orderId: locked.id,
          listingId: locked.listingId,
          buyerId: locked.buyerId,
          sellerId: locked.sellerId,
          totalAmount: Number(locked.totalAmount || 0),
          sellerRevenue: Number(locked.sellerRevenue || 0),
          cancelReason:
            locked.cancelReason?.trim() ||
            'رد کارشناسی؛ مرجوع از هاب به فروشنده',
          refundReason: 'hub-inspection-rejected-return',
        });

        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: locked.id,
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            tradeReputationAt: locked.tradeReputationAt,
          },
          OrderStatus.REJECTED_AT_HUB,
          'FAILURE',
          { failurePenalizeUserIds: [locked.sellerId] },
        );

        const rejectReason =
          locked.cancelReason?.trim() || 'رد کارشناسی؛ مرجوع از هاب به فروشنده';
        const listingRow = await tx.listing.findUnique({
          where: { id: locked.listingId },
          select: { title: true },
        });
        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: locked.listingId,
          sellerId: locked.sellerId,
          listingTitle: listingRow?.title ?? 'کالا',
          rejectionReason: rejectReason,
          source: 'hub-inspection',
          orderId: locked.id,
        });
      });
    }
    return updated;
  }

  async setTrackingCode(id: string, trackingCode: string) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: { id: true, buyerId: true, sellerId: true },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');

    const order = await this.prisma.order.update({
      where: { id },
      data: { trackingCode },
    });

    const message = `کد رهگیری سفارش شما: ${trackingCode}`;
    await this.prisma.notification.createMany({
      data: [
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'کد رهگیری ثبت شد',
          message,
          meta: { orderId: id, trackingCode } as Prisma.InputJsonValue,
        },
      ],
    });
    return order;
  }

  async setParticipantShipping(id: string, dto: SetParticipantShippingDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        buyerId: true,
        sellerId: true,
        trackingCode: true,
        sellerTrackingCode: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (!dto.sellerTrackingCode && !dto.buyerTrackingCode) {
      throw new BadRequestException('حداقل یک کد رهگیری باید ثبت شود');
    }
    if (existing.type !== 'EXCHANGE' && dto.buyerTrackingCode) {
      throw new BadRequestException(
        'کد رهگیری خریدار فقط برای سفارش‌های معاوضه قابل ثبت است',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id },
      data: {
        trackingCode: dto.sellerTrackingCode ?? existing.trackingCode,
        sellerTrackingCode:
          existing.type === 'EXCHANGE'
            ? (dto.buyerTrackingCode ?? existing.sellerTrackingCode)
            : existing.sellerTrackingCode,
      },
    });

    const buyerMsgParts = [
      dto.sellerTrackingCode
        ? `کد رهگیری ارسال فروشنده: ${dto.sellerTrackingCode}`
        : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode
        ? `کد رهگیری ارسال شما: ${dto.buyerTrackingCode}`
        : null,
      dto.buyerNote ? `توضیح برای شما: ${dto.buyerNote}` : null,
    ].filter(Boolean);
    const sellerMsgParts = [
      dto.sellerTrackingCode
        ? `کد رهگیری ارسال شما: ${dto.sellerTrackingCode}`
        : null,
      existing.type === 'EXCHANGE' && dto.buyerTrackingCode
        ? `کد رهگیری ارسال خریدار: ${dto.buyerTrackingCode}`
        : null,
      dto.sellerNote ? `توضیح برای شما: ${dto.sellerNote}` : null,
    ].filter(Boolean);

    await this.prisma.notification.createMany({
      data: [
        {
          userId: existing.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'به‌روزرسانی اطلاعات ارسال',
          message: buyerMsgParts.length
            ? buyerMsgParts.join(' | ')
            : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
          meta: {
            orderId: id,
            sellerTrackingCode: dto.sellerTrackingCode ?? null,
            buyerTrackingCode: dto.buyerTrackingCode ?? null,
            buyerNote: dto.buyerNote ?? null,
          } as Prisma.InputJsonValue,
        },
        {
          userId: existing.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'به‌روزرسانی اطلاعات ارسال',
          message: sellerMsgParts.length
            ? sellerMsgParts.join(' | ')
            : 'اطلاعات ارسال سفارش به‌روزرسانی شد.',
          meta: {
            orderId: id,
            sellerTrackingCode: dto.sellerTrackingCode ?? null,
            buyerTrackingCode: dto.buyerTrackingCode ?? null,
            sellerNote: dto.sellerNote ?? null,
          } as Prisma.InputJsonValue,
        },
      ],
    });

    return updated;
  }

  async setExchangeHubReceipt(id: string, dto: SetExchangeHubReceiptDto) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        exchangeHubInspection: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (existing.type !== 'EXCHANGE') {
      throw new BadRequestException(
        'این عملیات فقط برای سفارش معاوضه مجاز است',
      );
    }
    if (
      existing.status !== OrderStatus.SHIPPED_TO_HUB &&
      existing.status !== OrderStatus.RECEIVED_AT_HUB &&
      existing.status !== OrderStatus.CHECKING_AT_HUB
    ) {
      throw new BadRequestException(
        'سفارش در وضعیت مناسب برای ثبت دریافت مرسوله در هاب نیست',
      );
    }

    const prev =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ?? {};
    const next = {
      ...prev,
      sellerReceivedAtHub:
        dto.side === 'LISTING'
          ? dto.received
          : Boolean(prev['sellerReceivedAtHub']),
      buyerReceivedAtHub:
        dto.side === 'OFFER'
          ? dto.received
          : Boolean(prev['buyerReceivedAtHub']),
    };
    const bothReceived =
      Boolean(next.sellerReceivedAtHub) && Boolean(next.buyerReceivedAtHub);
    const targetStatus =
      existing.status === OrderStatus.CHECKING_AT_HUB
        ? OrderStatus.CHECKING_AT_HUB
        : bothReceived
          ? OrderStatus.RECEIVED_AT_HUB
          : OrderStatus.SHIPPED_TO_HUB;

    return this.prisma.order.update({
      where: { id },
      data: {
        status: targetStatus,
        exchangeHubInspection: next as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * پیام تیکت پس از کارشناسی معاوضه با مسیر «مرجوع هر دو» (رد یک‌طرفه، دوطرفه، یا ترکیبی).
   */
  private buildExchangeReturnInspectionTicketMessage(params: {
    role: 'seller' | 'buyer';
    orderId: string;
    listingTitle: string;
    listingUrl: string;
    ownTrackingCode: string | null;
    packagingVideoUrl: string | null;
    listingFailed: boolean;
    offerFailed: boolean;
    ownNote: string | null;
    otherNote: string | null;
  }): string {
    const shortId = params.orderId.slice(-6);
    const penalty = TRADE_REPUTATION_PENALTY_DELTA;
    const isSeller = params.role === 'seller';
    const ownFailed = isSeller ? params.listingFailed : params.offerFailed;
    const otherFailed = isSeller ? params.offerFailed : params.listingFailed;
    const bothFailed = params.listingFailed && params.offerFailed;

    const lines: string[] = [];

    if (bothFailed) {
      lines.push(
        `نتیجه کارشناسی معاوضه #${shortId} برای «${params.listingTitle}»: هر دو کالا رد شدند و معامله لغو گردید.`,
        `امتیاز معاملاتی هر دو طرف ${penalty} واحد کاهش یافت.`,
      );
    } else if (ownFailed) {
      lines.push(
        `نتیجه کارشناسی معاوضه #${shortId} برای «${params.listingTitle}»: کالای ارسالی شما رد شد و معامله لغو گردید.`,
        `طبق قوانین طبقه، ${penalty} واحد از امتیاز معاملاتی شما کسر شد.`,
        params.ownNote
          ? `توضیح کارشناسی: ${params.ownNote}`
          : 'توضیح کارشناسی: مطابق گزارش هاب.',
      );
    } else if (otherFailed) {
      lines.push(
        `متأسفیم؛ معامله معاوضه #${shortId} برای «${params.listingTitle}» به‌دلیل رد کالای طرف مقابل لغو شد.`,
        'کالای شما از نظر کارشناسی تایید شد؛ از بابت این تجربه ناخوشایند صمیمانه پوزش می‌خواهیم.',
        params.otherNote
          ? `توضیح رد کالای طرف مقابل: ${params.otherNote}`
          : null,
      );
    } else {
      lines.push(
        `نتیجه کارشناسی معاوضه #${shortId}: معامله لغو و مرجوع هر دو کالا در دست اقدام است.`,
      );
    }

    lines.push(
      'هزینه کارشناسی مسترد نمی‌شود.',
      'در صورت پرداخت مابه‌التفاوت، پس از ثبت هر دو کد رهگیری مرجوعی از هاب در صف «ارسال از طبقه»، همان مبلغ (بدون کارشناسی) به کیف پول شما بازمی‌گردد.',
      `لینک آگهی: ${params.listingUrl}`,
      `کد رهگیری ارسال شما به هاب: ${params.ownTrackingCode ?? 'ثبت نشده'}`,
      params.packagingVideoUrl
        ? `ویدیوی بسته‌بندی شما: ${params.packagingVideoUrl}`
        : null,
      'در صورت نیاز می‌توانید از همین تیکت با پشتیبانی در ارتباط باشید.',
    );

    return formatTicketMessageBody(lines.filter((line): line is string => Boolean(line)));
  }

  /**
   * معاوضه: ثبت نتیجه کارشناسی جداگانه برای هر کالا + انتخاب یکی از سه مسیر نهایی:
   * ارسال به مقصد | مرجوع هر دو | ادامه با توافق مالی (مصالحه در همان صفحه ادمین).
   */
  async finalizeExchangeHubInspection(
    id: string,
    dto: FinalizeExchangeHubInspectionDto,
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        status: true,
        exchangeHubInspection: true,
        verificationFee: true,
        totalAmount: true,
        sellerRevenue: true,
        exchangeOfferId: true,
        buyerId: true,
        sellerId: true,
        tradeReputationAt: true,
        trackingCode: true,
        sellerTrackingCode: true,
        packagingVideo: true,
        buyerPackagingVideo: true,
        listing: { select: { id: true, title: true } },
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (existing.type !== 'EXCHANGE') {
      throw new BadRequestException(
        'این عملیات فقط برای سفارش معاوضه مجاز است',
      );
    }
    if (existing.status !== OrderStatus.CHECKING_AT_HUB) {
      throw new BadRequestException(
        'سفارش باید در وضعیت «در حال بررسی در هاب» باشد',
      );
    }

    const itemNeedsNote = (v: string) =>
      v === 'FAIL' || v === 'PASS_WITH_SETTLEMENT';
    if (itemNeedsNote(dto.listingItem) && !dto.listingNote?.trim()) {
      throw new BadRequestException(
        'برای کالای آگهی، با این نتیجه ثبت توضیح الزامی است',
      );
    }
    if (itemNeedsNote(dto.offerItem) && !dto.offerNote?.trim()) {
      throw new BadRequestException(
        'برای کالای پیشنهاد، با این نتیجه ثبت توضیح الزامی است',
      );
    }

    const resolution = dto.resolution;
    const listingFailed = dto.listingItem === 'FAIL';
    const offerFailed = dto.offerItem === 'FAIL';
    const hasAnyFail = listingFailed || offerFailed;

    if (resolution === 'SHIP_TO_DESTINATIONS') {
      if (dto.listingItem !== 'PASS' || dto.offerItem !== 'PASS') {
        throw new BadRequestException(
          'برای «ارسال به مقصد»، هر دو کالا باید «تایید سلامت / بدون ایراد» باشند',
        );
      }
    } else if (resolution === 'RETURN_BOTH_TO_SENDERS') {
      if (!hasAnyFail) {
        throw new BadRequestException(
          'برای «مرجوع هر دو کالا»، حداقل یکی از کالاها باید «رد کارشناسی» باشد',
        );
      }
    } else if (resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP') {
      if (dto.listingItem === 'FAIL' || dto.offerItem === 'FAIL') {
        throw new BadRequestException(
          'در مسیر «توافق مالی و ادامه»، نباید کالایی در وضعیت «رد کامل» باشد',
        );
      }
      if (
        dto.listingItem !== 'PASS_WITH_SETTLEMENT' &&
        dto.offerItem !== 'PASS_WITH_SETTLEMENT'
      ) {
        throw new BadRequestException(
          'برای «توافق مالی و ادامه»، حداقل یکی از کالاها باید «تایید مشروط / نیاز به اصلاح مالی» باشد؛ اگر هر دو بدون ایرادند از «ارسال به مقصد» استفاده کنید',
        );
      }
    }
    if (hasAnyFail && resolution !== 'RETURN_BOTH_TO_SENDERS') {
      throw new BadRequestException(
        'با رد شدن حتی یکی از کالاها، معامله باید کنسل شود و مسیر «مرجوع هر دو کالا» انتخاب شود',
      );
    }
    if (
      hasAnyFail &&
      (dto.listingItem === 'PASS_WITH_SETTLEMENT' ||
        dto.offerItem === 'PASS_WITH_SETTLEMENT')
    ) {
      throw new BadRequestException(
        'وقتی حتی یکی از کالاها رد شده باشد، اصلاح مالی غیرفعال است و نتیجه کالای دیگر باید فقط «تایید سلامت» یا «رد کارشناسی» باشد',
      );
    }

    // در سیاست جدید، هر کالایی که رد شود، جریمه همان طرف به‌صورت خودکار اعمال می‌شود.
    const listingApplyPenalty = listingFailed;
    const offerApplyPenalty = offerFailed;

    const inspectionBase = {
      listingItem: dto.listingItem,
      offerItem: dto.offerItem,
      listingNote: dto.listingNote?.trim() || null,
      offerNote: dto.offerNote?.trim() || null,
      listingApplyPenalty,
      offerApplyPenalty,
      resolution,
      finalizedAt: new Date().toISOString(),
    };
    const prevInspection =
      (existing.exchangeHubInspection as Record<string, unknown> | null) ?? {};
    const mergeInspectionPayload = (extra: Record<string, unknown>) => ({
      ...prevInspection,
      ...inspectionBase,
      ...extra,
    });

    const itemLabel = (v: string) =>
      v === 'PASS'
        ? 'تایید سلامت (بدون ایراد)'
        : v === 'FAIL'
          ? 'رد کارشناسی'
          : 'تایید مشروط / نیاز به اصلاح مالی';

    const apiUrl = this.appSettings.getApiUrl().replace(/\/$/, '');
    const listingUrl = `${apiUrl}/listing/${existing.listing.id}`;
    const packagingVideoUrl = existing.packagingVideo
      ? `${apiUrl}/uploads/orders/videos/${existing.packagingVideo}`
      : null;
    const buyerPackagingVideoUrl = existing.buyerPackagingVideo
      ? `${apiUrl}/uploads/orders/videos/${existing.buyerPackagingVideo}`
      : null;

    if (resolution === 'SHIP_TO_DESTINATIONS') {
      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
      });
      const updated = await this.prisma.order.update({
        where: { id },
        data: {
          status: OrderStatus.VERIFIED_AT_HUB,
          exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
        },
      });
      await this.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.VERIFIED_AT_HUB,
        'نتیجه کارشناسی: هر دو کالا تایید شد و برای ارسال به مقصد نهایی آماده می‌شود.',
      );
      return updated;
    }

    if (resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP') {
      const listingSettlementAmount =
        dto.listingItem === 'PASS_WITH_SETTLEMENT'
          ? Number(dto.listingSettlementAmount || 0)
          : 0;
      const offerSettlementAmount =
        dto.offerItem === 'PASS_WITH_SETTLEMENT'
          ? Number(dto.offerSettlementAmount || 0)
          : 0;
      if (
        dto.listingItem === 'PASS_WITH_SETTLEMENT' &&
        listingSettlementAmount <= 0
      ) {
        throw new BadRequestException(
          'برای کالای آگهی با اصلاح مالی، مبلغ اصلاح الزامی است',
        );
      }
      if (
        dto.offerItem === 'PASS_WITH_SETTLEMENT' &&
        offerSettlementAmount <= 0
      ) {
        throw new BadRequestException(
          'برای کالای پیشنهاد با اصلاح مالی، مبلغ اصلاح الزامی است',
        );
      }
      const listingSettlementDirection =
        dto.listingItem === 'PASS_WITH_SETTLEMENT'
          ? dto.listingSettlementDirection || 'DEBIT'
          : null;
      const offerSettlementDirection =
        dto.offerItem === 'PASS_WITH_SETTLEMENT'
          ? dto.offerSettlementDirection || 'DEBIT'
          : null;
      if (
        (dto.listingItem === 'PASS_WITH_SETTLEMENT' &&
          listingSettlementDirection !== 'DEBIT') ||
        (dto.offerItem === 'PASS_WITH_SETTLEMENT' &&
          offerSettlementDirection !== 'DEBIT')
      ) {
        throw new BadRequestException(
          'در معاوضه، اصلاح مالی فقط کاهشی است و جهت CREDIT مجاز نیست',
        );
      }
      const sellerBefore = Number(existing.sellerRevenue || 0);
      const buyerBefore = Math.max(
        0,
        Number(existing.totalAmount || 0) - sellerBefore,
      );
      // اصلاح مالی همیشه "کاهشی" است:
      // listingSettlementAmount => کاهش از فروشنده و افزایش به خریدار
      // offerSettlementAmount => کاهش از خریدار و افزایش به فروشنده
      const sellerAfter = Math.max(
        0,
        sellerBefore - listingSettlementAmount + offerSettlementAmount,
      );
      const buyerAfter = Math.max(
        0,
        buyerBefore + listingSettlementAmount - offerSettlementAmount,
      );
      const settlementSummary = {
        sellerAdjustment: {
          before: sellerBefore,
          after: sellerAfter,
          delta: sellerAfter - sellerBefore,
        },
        buyerAdjustment: {
          before: buyerBefore,
          after: buyerAfter,
          delta: buyerAfter - buyerBefore,
        },
        listingAdjustment: listingSettlementAmount
          ? {
              amount: listingSettlementAmount,
              direction: listingSettlementDirection,
              deltaToSeller: -listingSettlementAmount,
            }
          : null,
        offerAdjustment: offerSettlementAmount
          ? {
              amount: offerSettlementAmount,
              direction: offerSettlementDirection,
              deltaToBuyer: -offerSettlementAmount,
            }
          : null,
        reason:
          [dto.listingNote?.trim(), dto.offerNote?.trim()]
            .filter(Boolean)
            .join(' | ') || null,
        settledAt: new Date().toISOString(),
      };
      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
        pendingFinancialSettlement: null,
        financialSettlementSummary: settlementSummary,
        financeSettledAt: new Date().toISOString(),
      });
      const summaryText = [
        'نتیجه کارشناسی هر کالا ثبت شد و توافق مالی در همان مرحله نهایی شد:',
        `کالای آگهی: ${itemLabel(dto.listingItem)}`,
        dto.listingNote?.trim() ? `  توضیح: ${dto.listingNote.trim()}` : null,
        `کالای پیشنهاد: ${itemLabel(dto.offerItem)}`,
        dto.offerNote?.trim() ? `  توضیح: ${dto.offerNote.trim()}` : null,
        `اصلاح مالی نهایی اعمال شد: ${Math.abs(sellerAfter - sellerBefore).toLocaleString('fa-IR')} تومان`,
        'سفارش وارد مرحله ارسال از هاب شد.',
      ]
        .filter(Boolean)
        .join('\n');

      const updated = await this.prisma.$transaction(async (tx) => {
        const offer = existing.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: existing.exchangeOfferId },
              select: { extraPayment: true, isPayerMe: true },
            })
          : null;
        if (!offer) {
          throw new BadRequestException(
            'اطلاعات پیشنهاد معاوضه برای تسویه مالی یافت نشد',
          );
        }

        const extra = Number(offer.extraPayment || 0);
        const hasExtraPayment = extra > 0;
        const extraReceiverUserId = hasExtraPayment
          ? offer.isPayerMe
            ? existing.sellerId
            : existing.buyerId
          : null;
        const sellerIsExtraReceiver = extraReceiverUserId === existing.sellerId;
        const buyerIsExtraReceiver = extraReceiverUserId === existing.buyerId;

        const sellerWallet = await tx.wallet.upsert({
          where: { userId: existing.sellerId },
          create: {
            userId: existing.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: {},
          select: { id: true, balanceAvailable: true, balanceBlocked: true },
        });
        const buyerWallet = await tx.wallet.upsert({
          where: { userId: existing.buyerId },
          create: {
            userId: existing.buyerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: {},
          select: { id: true, balanceAvailable: true, balanceBlocked: true },
        });

        if (listingSettlementAmount > 0 && !sellerIsExtraReceiver) {
          const sellerAvailableNow = Number(sellerWallet.balanceAvailable || 0);
          if (listingSettlementAmount > sellerAvailableNow) {
            return {
              kind: 'awaiting_wallet_topup' as const,
              debtorUserId: existing.sellerId,
              shortfall: listingSettlementAmount - sellerAvailableNow,
            };
          }
        }
        if (offerSettlementAmount > 0 && !buyerIsExtraReceiver) {
          const buyerAvailableNow = Number(buyerWallet.balanceAvailable || 0);
          if (offerSettlementAmount > buyerAvailableNow) {
            return {
              kind: 'awaiting_wallet_topup' as const,
              debtorUserId: existing.buyerId,
              shortfall: offerSettlementAmount - buyerAvailableNow,
            };
          }
        }

        // ۱) اصلاح مالی کالای فروشنده: کاهش از فروشنده -> افزایش به خریدار
        if (listingSettlementAmount > 0) {
          if (!sellerIsExtraReceiver) {
            // حالت ۱: کسر از پرداخت‌کننده سرک -> از available و افزودن به blocked طرف مقابل
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: {
                balanceAvailable: { decrement: listingSettlementAmount },
              },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'seller_settlement_debit_available',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${listingSettlementAmount.toLocaleString('fa-IR')} تومان از موجودی قابل برداشت فروشنده کسر شد.`,
                },
              },
            });
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: { balanceBlocked: { increment: listingSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.PENDING,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'buyer_settlement_blocked',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${listingSettlementAmount.toLocaleString('fa-IR')} تومان به مبلغ بلوکه خریدار اضافه شد.`,
                },
              },
            });
          } else {
            // حالت ۲: کسر از دریافت‌کننده سرک -> از blocked و بازگشت مستقیم به available پرداخت‌کننده سرک
            const sellerBlockedNow = Number(sellerWallet.balanceBlocked || 0);
            if (listingSettlementAmount > sellerBlockedNow) {
              throw new BadRequestException(
                'برای اعمال اصلاح مالی کالای فروشنده، مبلغ بلوکه‌شده فروشنده کافی نیست',
              );
            }
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: { balanceBlocked: { decrement: listingSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'seller_settlement_debit_blocked',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${listingSettlementAmount.toLocaleString('fa-IR')} تومان از مبلغ بلوکه‌شده فروشنده کسر شد.`,
                },
              },
            });
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: {
                balanceAvailable: { increment: listingSettlementAmount },
              },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: listingSettlementAmount,
                type: WalletTransactionType.REFUND,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'buyer_settlement_credit_available',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${listingSettlementAmount.toLocaleString('fa-IR')} تومان به پرداخت‌کننده سرک برگشت و به موجودی قابل برداشت او اضافه شد.`,
                },
              },
            });
          }
        }

        // ۲) اصلاح مالی کالای خریدار: کاهش از خریدار -> افزایش به فروشنده
        if (offerSettlementAmount > 0) {
          if (!buyerIsExtraReceiver) {
            // حالت ۱: کسر از پرداخت‌کننده سرک -> از available و افزودن به blocked طرف مقابل
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: { balanceAvailable: { decrement: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'buyer_settlement_debit_available',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${offerSettlementAmount.toLocaleString('fa-IR')} تومان از موجودی قابل برداشت خریدار کسر شد.`,
                },
              },
            });
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: { balanceBlocked: { increment: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.DEPOSIT,
                status: WalletTransactionStatus.PENDING,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'seller_settlement_blocked',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${offerSettlementAmount.toLocaleString('fa-IR')} تومان به مبلغ بلوکه فروشنده اضافه شد.`,
                },
              },
            });
          } else {
            // حالت ۲: کسر از دریافت‌کننده سرک -> از blocked و بازگشت مستقیم به available پرداخت‌کننده سرک
            const buyerBlockedNow = Number(buyerWallet.balanceBlocked || 0);
            if (offerSettlementAmount > buyerBlockedNow) {
              throw new BadRequestException(
                'برای اعمال اصلاح مالی کالای خریدار، مبلغ بلوکه‌شده خریدار کافی نیست',
              );
            }
            await tx.wallet.update({
              where: { userId: existing.buyerId },
              data: { balanceBlocked: { decrement: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: buyerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'buyer_settlement_debit_blocked',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${offerSettlementAmount.toLocaleString('fa-IR')} تومان از مبلغ بلوکه‌شده خریدار کسر شد.`,
                },
              },
            });
            await tx.wallet.update({
              where: { userId: existing.sellerId },
              data: { balanceAvailable: { increment: offerSettlementAmount } },
            });
            await tx.walletTransaction.create({
              data: {
                walletId: sellerWallet.id,
                amount: offerSettlementAmount,
                type: WalletTransactionType.REFUND,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: existing.id,
                meta: {
                  kind: 'order-escrow',
                  phase: 'seller_settlement_credit_available',
                  settlementKind: 'exchange-financial-settlement',
                  description: `اصلاح مالی معاوضه: ${offerSettlementAmount.toLocaleString('fa-IR')} تومان به پرداخت‌کننده سرک برگشت و به موجودی قابل برداشت او اضافه شد.`,
                },
              },
            });
          }
        }

        return {
          kind: 'completed' as const,
          order: await tx.order.update({
            where: { id },
            data: {
              status: OrderStatus.VERIFIED_AT_HUB,
              cancelReason: summaryText,
              sellerRevenue: sellerAfter,
              exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
            },
          }),
        };
      });

      if (updated.kind === 'awaiting_wallet_topup') {
        const pendingPayload = mergeInspectionPayload({
          awaitingFinanceSettlement: true,
          pendingFinancialSettlement: {
            listingItem: dto.listingItem,
            offerItem: dto.offerItem,
            listingSettlementAmount,
            offerSettlementAmount,
            listingSettlementDirection,
            offerSettlementDirection,
            listingNote: dto.listingNote?.trim() || null,
            offerNote: dto.offerNote?.trim() || null,
            debtorUserId: updated.debtorUserId,
            shortfall: updated.shortfall,
            requestedAt: new Date().toISOString(),
          },
          financialSettlementSummary: null,
        });
        const awaitingOrder = await this.prisma.order.update({
          where: { id },
          data: {
            status: OrderStatus.CHECKING_AT_HUB,
            cancelReason: [
              summaryText,
              'در انتظار شارژ کیف پول برای تکمیل توافق مالی.',
              `کسری موجودی: ${updated.shortfall.toLocaleString('fa-IR')} تومان`,
            ].join('\n'),
            exchangeHubInspection: pendingPayload as Prisma.InputJsonValue,
          },
        });
        const debtorLabel =
          updated.debtorUserId === existing.sellerId ? 'فروشنده' : 'خریدار';
        await this.prisma.notification.createMany({
          data: [
            {
              userId: updated.debtorUserId,
              type: NotificationType.ORDER_STATUS_CHANGED,
              title: 'شارژ کیف پول برای ادامه معاوضه',
              message: `برای اعمال توافق مالی کارشناسی، ${updated.shortfall.toLocaleString('fa-IR')} تومان به کیف پول شما نیاز است. پس از شارژ، پشتیبانی دوباره تسویه را ثبت می‌کند.`,
              meta: {
                orderId: id,
                shortfall: updated.shortfall,
                awaitingFinanceSettlement: true,
              } as Prisma.InputJsonValue,
            },
            {
              userId:
                updated.debtorUserId === existing.buyerId
                  ? existing.sellerId
                  : existing.buyerId,
              type: NotificationType.ORDER_STATUS_CHANGED,
              title: 'در انتظار تسویه مالی معاوضه',
              message: `معامله در انتظار شارژ کیف پول ${debtorLabel} برای تکمیل توافق مالی کارشناسی است.`,
              meta: { orderId: id } as Prisma.InputJsonValue,
            },
          ],
        });
        return awaitingOrder;
      }

      await this.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.VERIFIED_AT_HUB,
        summaryText,
      );
      return updated.order;
    }

    // RETURN_BOTH_TO_SENDERS
    const summaryLines = [
      'نتیجه کارشناسی معاوضه — مرجوع هر دو کالا به فرستندگان:',
      `۱) کالای آگهی: ${itemLabel(dto.listingItem)}`,
      dto.listingNote?.trim() ? `   توضیح: ${dto.listingNote.trim()}` : null,
      `۲) کالای پیشنهاد: ${itemLabel(dto.offerItem)}`,
      dto.offerNote?.trim() ? `   توضیح: ${dto.offerNote.trim()}` : null,
    ].filter(Boolean) as string[];

    const summaryText = summaryLines.join('\n');
    const compensationPercent =
      await this.readExchangeNoShipmentCompensationPercent();

    return this.prisma.$transaction(async (tx) => {
      await this.walletService.applyExchangeHubInspectionOutcomeRefunds(tx, {
        orderId: id,
        listingId: existing.listing.id,
        buyerId: existing.buyerId,
        sellerId: existing.sellerId,
        verificationFee: Number(existing.verificationFee || 0),
        inspectionPenaltyPercent: compensationPercent,
        listingFailed,
        offerFailed,
      });

      const inspectionPayload = mergeInspectionPayload({
        awaitingFinanceSettlement: false,
        financialSettlementSummary: null,
        lastFinancialSettlement: null,
        awaitingReturnConfirmations: true,
        buyerReturnReceived: false,
        sellerReturnReceived: false,
        refundsReleasedAt: new Date().toISOString(),
      });

      const updatedOrder = await tx.order.update({
        where: { id },
        data: {
          status: OrderStatus.REJECTED_AT_HUB,
          cancelReason: summaryText,
          exchangeHubInspection: inspectionPayload as Prisma.InputJsonValue,
        },
      });

      const failurePenalizeUserIds: string[] = [];
      if (listingFailed) failurePenalizeUserIds.push(existing.sellerId);
      if (offerFailed) failurePenalizeUserIds.push(existing.buyerId);

      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: existing.id,
          buyerId: existing.buyerId,
          sellerId: existing.sellerId,
          tradeReputationAt: existing.tradeReputationAt,
        },
        existing.status,
        'FAILURE',
        { failurePenalizeUserIds },
      );

      if (hasAnyFail) {
        const bothFailed = listingFailed && offerFailed;
        const rejectionReason = bothFailed
          ? 'رد کارشناسی هر دو کالا در معاوضه؛ آگهی از انتشار خارج شد.'
          : listingFailed
            ? `رد کارشناسی کالای آگهی (معاوضه): ${dto.listingNote?.trim() || 'مطابق گزارش کارشناسی'}`
            : `رد کارشناسی کالای پیشنهاد (معاوضه): ${dto.offerNote?.trim() || 'مطابق گزارش کارشناسی'}`;
        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: existing.listing.id,
          sellerId: existing.sellerId,
          listingTitle: existing.listing.title,
          rejectionReason,
          source: 'hub-inspection',
          orderId: id,
        });
      }

      const sellerTicketMessage =
        this.buildExchangeReturnInspectionTicketMessage({
          role: 'seller',
          orderId: id,
          listingTitle: existing.listing.title,
          listingUrl,
          ownTrackingCode: existing.trackingCode,
          packagingVideoUrl,
          listingFailed,
          offerFailed,
          ownNote: dto.listingNote?.trim() || null,
          otherNote: dto.offerNote?.trim() || null,
        });

      const sellerTicket = await tx.ticket.create({
        data: {
          userId: existing.sellerId,
          subject: buildOrderTicketSubject('کارشناسی معاوضه — مرجوع دوطرفه', id),
          status: 'OPEN',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: sellerTicketMessage,
            },
          },
        },
        select: { id: true },
      });

      await tx.notification.create({
        data: {
          userId: existing.sellerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت نتیجه کارشناسی معاوضه',
          message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
          meta: {
            orderId: id,
            ticketId: sellerTicket.id,
          } as Prisma.InputJsonValue,
        },
      });

      const buyerTicketMessage =
        this.buildExchangeReturnInspectionTicketMessage({
          role: 'buyer',
          orderId: id,
          listingTitle: existing.listing.title,
          listingUrl,
          ownTrackingCode: existing.sellerTrackingCode,
          packagingVideoUrl: buyerPackagingVideoUrl,
          listingFailed,
          offerFailed,
          ownNote: dto.offerNote?.trim() || null,
          otherNote: dto.listingNote?.trim() || null,
        });

      const buyerTicket = await tx.ticket.create({
        data: {
          userId: existing.buyerId,
          subject: buildOrderTicketSubject('کارشناسی معاوضه — مرجوع دوطرفه', id),
          status: 'OPEN',
          messages: {
            create: { senderRole: UserRole.ADMIN, message: buyerTicketMessage },
          },
        },
        select: { id: true },
      });

      await tx.notification.create({
        data: {
          userId: existing.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت نتیجه کارشناسی معاوضه',
          message: `برای سفارش #${id.slice(-6)} تیکت پشتیبانی ایجاد شد.`,
          meta: {
            orderId: id,
            ticketId: buyerTicket.id,
          } as Prisma.InputJsonValue,
        },
      });

      await this.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        OrderStatus.REJECTED_AT_HUB,
        summaryText,
      );

      return updatedOrder;
    });
  }

  async resolveEscrow(id: string, dto: ResolveOrderEscrowDto) {
    return this.prisma.$transaction(async (tx) => {
      const action = dto.action;
      const note = dto.note;
      const order = await tx.order.findUnique({
        where: { id },
        select: {
          id: true,
          type: true,
          buyerId: true,
          sellerId: true,
          listingId: true,
          listing: {
            select: {
              title: true,
              sellerRequiresVerification: true,
              categoryId: true,
            },
          },
          finalPrice: true,
          status: true,
          sellerRevenue: true,
          totalAmount: true,
          platformFee: true,
          shippingCost: true,
          verificationFee: true,
          requiresVerification: true,
          exchangeOfferId: true,
          returnTrackingCode: true,
          exchangeHubInspection: true,
          tradeReputationAt: true,
        },
      });
      if (!order) throw new NotFoundException('سفارش یافت نشد');
      if (
        order.status === OrderStatus.CANCELLED ||
        order.status === OrderStatus.COMPLETED
      ) {
        throw new BadRequestException('این سفارش قبلاً تعیین تکلیف شده است');
      }

      const sellerRevenue = Number(order.sellerRevenue);
      const totalAmount = Number(order.totalAmount);
      const finalPrice = Number(order.finalPrice || 0);
      const shippingCost = Number(order.shippingCost || 0);
      const verificationFee = Number(order.verificationFee || 0);
      const platformFee = Number(order.platformFee || 0);
      const sellerVerificationFee =
        order.requiresVerification &&
        Boolean(order.listing?.sellerRequiresVerification)
          ? verificationFee
          : 0;
      const verificationChargedToBuyer =
        order.requiresVerification && !order.listing?.sellerRequiresVerification
          ? verificationFee
          : 0;
      const exchangeOffer =
        order.type === 'EXCHANGE' && order.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: order.exchangeOfferId },
              select: { extraPayment: true, isPayerMe: true },
            })
          : null;
      const exchangeExtra = Number(exchangeOffer?.extraPayment || 0);
      const exchangeBuyerShare =
        verificationFee + (exchangeOffer?.isPayerMe ? exchangeExtra : 0);
      const exchangeSellerShare =
        verificationFee + (!exchangeOffer?.isPayerMe ? exchangeExtra : 0);
      const exchangeBuyerRefundable = Math.max(
        0,
        exchangeBuyerShare - verificationFee,
      );
      const exchangeSellerRefundable = Math.max(
        0,
        exchangeSellerShare - verificationFee,
      );
      const refundableToBuyerAfterReturn = Math.max(
        0,
        totalAmount - shippingCost - verificationChargedToBuyer,
      );
      const maxNegotiableRefund = Math.max(0, finalPrice);

      if (
        order.type === 'EXCHANGE' &&
        action !== AdminEscrowAction.RELEASE_TO_SELLER &&
        action !== AdminEscrowAction.REFUND_TO_BUYER &&
        action !== AdminEscrowAction.PARTIAL_REFUND_AND_CONTINUE &&
        action !== AdminEscrowAction.CANCEL_AND_RETURN_BOTH_TO_SENDERS
      ) {
        throw new BadRequestException(
          'اقدام انتخاب‌شده برای سفارش معاوضه پشتیبانی نمی‌شود',
        );
      }

      if (action === AdminEscrowAction.CANCEL_AND_RETURN_BOTH_TO_SENDERS) {
        if (order.type !== 'EXCHANGE') {
          throw new BadRequestException(
            'این تصمیم فقط برای سفارش‌های معاوضه قابل استفاده است',
          );
        }
        const returnToBuyer = (dto.returnTrackingCodeToBuyer ?? '').trim();
        const returnToSeller = (dto.returnTrackingCodeToSeller ?? '').trim();
        if (returnToBuyer.length < 3 || returnToSeller.length < 3) {
          throw new BadRequestException(
            'کد رهگیری بازگشت به هر دو طرف الزامی است',
          );
        }

        if (order.type === 'EXCHANGE') {
          if (exchangeOffer?.isPayerMe && exchangeBuyerRefundable > 0) {
            await tx.wallet.upsert({
              where: { userId: order.sellerId },
              create: {
                userId: order.sellerId,
                balanceAvailable: 0,
                balanceBlocked: 0,
              },
              update: {
                balanceBlocked: { decrement: exchangeBuyerRefundable },
              },
            });
            await tx.walletTransaction.create({
              data: {
                wallet: { connect: { userId: order.sellerId } },
                amount: exchangeBuyerRefundable,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: order.id,
                meta: {
                  kind: 'exchange-cancel-both-rejected',
                  description:
                    'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت',
                  adminNote: note ?? null,
                },
              },
            });
          }
          if (!exchangeOffer?.isPayerMe && exchangeSellerRefundable > 0) {
            await tx.wallet.upsert({
              where: { userId: order.buyerId },
              create: {
                userId: order.buyerId,
                balanceAvailable: 0,
                balanceBlocked: 0,
              },
              update: {
                balanceBlocked: { decrement: exchangeSellerRefundable },
              },
            });
            await tx.walletTransaction.create({
              data: {
                wallet: { connect: { userId: order.buyerId } },
                amount: exchangeSellerRefundable,
                type: WalletTransactionType.PENALTY,
                status: WalletTransactionStatus.SUCCESS,
                referenceId: order.id,
                meta: {
                  kind: 'exchange-cancel-both-rejected',
                  description:
                    'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت',
                  adminNote: note ?? null,
                },
              },
            });
          }
        } else if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: sellerRevenue } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                kind: 'exchange-cancel-both-rejected',
                description:
                  'لغو معاوضه پس از رد هر دو کالا؛ کسر سهم بلوکه فروشنده',
                adminNote: note ?? null,
              },
            },
          });
        }
        const buyerRefundOnCancel =
          order.type === 'EXCHANGE' ? exchangeBuyerRefundable : totalAmount;
        if (buyerRefundOnCancel > 0) {
          await tx.wallet.upsert({
            where: { userId: order.buyerId },
            create: {
              userId: order.buyerId,
              balanceAvailable: buyerRefundOnCancel,
              balanceBlocked: 0,
            },
            update: { balanceAvailable: { increment: buyerRefundOnCancel } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.buyerId } },
              amount: buyerRefundOnCancel,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                kind: 'exchange-cancel-both-rejected',
                description:
                  order.type === 'EXCHANGE'
                    ? 'لغو معاوضه پس از رد هر دو کالا؛ بازگشت مابه‌التفاوت پرداختی خریدار (بدون کارشناسی)'
                    : 'لغو معاوضه پس از رد هر دو کالا؛ بازگشت وجه خریدار',
                adminNote: note ?? null,
              },
            },
          });
        }
        if (order.type === 'EXCHANGE' && exchangeSellerRefundable > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: exchangeSellerRefundable,
              balanceBlocked: 0,
            },
            update: {
              balanceAvailable: { increment: exchangeSellerRefundable },
            },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: exchangeSellerRefundable,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                kind: 'exchange-cancel-both-rejected',
                description:
                  'لغو معاوضه پس از رد هر دو کالا؛ بازگشت مابه‌التفاوت پرداختی فروشنده (بدون کارشناسی)',
                adminNote: note ?? null,
              },
            },
          });
        }

        const prevCancelBoth = order.status;
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: [
              'هر دو کالای معاوضه در کارشناسی رد شدند؛ معامله لغو شد.',
              `رهگیری برگشت به خریدار: ${returnToBuyer}`,
              `رهگیری برگشت به فروشنده: ${returnToSeller}`,
              note ? `توضیح: ${note}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
            hubToBuyerTrackingCode: returnToBuyer,
            hubToSellerTrackingCode: returnToSeller,
            returnConfirmedAt: new Date(),
          },
        });

        const cancelBothInsp =
          (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
        const cancelBothListingFail = cancelBothInsp['listingItem'] === 'FAIL';
        const cancelBothOfferFail = cancelBothInsp['offerItem'] === 'FAIL';
        const cancelBothPenaltyIds: string[] = [];
        if (cancelBothListingFail) cancelBothPenaltyIds.push(order.sellerId);
        if (cancelBothOfferFail) cancelBothPenaltyIds.push(order.buyerId);

        await this.orderReputation.recordTerminalOutcome(
          tx,
          {
            id: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            tradeReputationAt: order.tradeReputationAt,
          },
          prevCancelBoth,
          'FAILURE',
          cancelBothPenaltyIds.length > 0
            ? { failurePenalizeUserIds: cancelBothPenaltyIds }
            : undefined,
        );

        await tx.listing.update({
          where: { id: order.listingId },
          data: { status: ListingStatus.APPROVED },
        });

        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.CANCELLED,
          note ??
            'هر دو کالا رد شد؛ معامله لغو و مرجوعی برای هر دو طرف ثبت شد.',
        );

        return updated;
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.RETURN_REQUESTED
      ) {
        throw new BadRequestException(
          'ابتدا خریدار باید کد رهگیری مرجوعی را ثبت کند',
        );
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.RETURN_SHIPPED
      ) {
        throw new BadRequestException(
          'این سفارش در مرحله مرجوعی ثبت‌شده است؛ برای بازگشت وجه فقط از «تایید مرجوعی و بازگشت وجه» استفاده کنید تا دوبار بازپرداخت نشود.',
        );
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        (order.status === OrderStatus.DELIVERED ||
          order.status === OrderStatus.DISPUTED)
      ) {
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.RETURN_REQUESTED,
            cancelReason: note ?? 'مرجوعی کالا توسط خریدار در انتظار ثبت است',
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.RETURN_REQUESTED,
          note ?? 'خریدار باید کالا را مرجوع و کد رهگیری را ثبت کند',
        );
        return updated;
      }

      if (action === AdminEscrowAction.PARTIAL_REFUND_AND_CONTINUE) {
        const refundAmount = Number(dto.refundToBuyerAmount ?? 0);
        if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
          throw new BadRequestException('مبلغ بازپرداخت جزئی نامعتبر است');
        }
        if (refundAmount > maxNegotiableRefund) {
          throw new BadRequestException(
            `حداکثر مبلغ قابل بازپرداخت با توجه به کسر کارشناسی و سود مجموعه ${maxNegotiableRefund.toLocaleString('fa-IR')} تومان است`,
          );
        }
        if (refundAmount > sellerRevenue) {
          throw new BadRequestException(
            'مبلغ بازپرداخت از سهم بلوکه‌شده فروشنده بیشتر است',
          );
        }

        const sellerWallet = await tx.wallet.findUnique({
          where: { userId: order.sellerId },
          select: { balanceBlocked: true, balanceAvailable: true },
        });
        const sellerBlockedNow = Number(sellerWallet?.balanceBlocked ?? 0);
        const sellerAvailableNow = Number(sellerWallet?.balanceAvailable ?? 0);
        const fromSellerBlocked = Math.min(refundAmount, sellerBlockedNow);
        const fromSellerAvailable = refundAmount - fromSellerBlocked;
        if (fromSellerAvailable > sellerAvailableNow) {
          throw new BadRequestException(
            'موجودی کیف پول کاربر (فروشنده) برای این تسویه کافی نیست؛ ابتدا از بلوکه همین معامله کسر می‌شود و اگر کافی نبود از موجودی آزاد؛ موجودی آزاد کافی نیست.',
          );
        }

        const recalculatedFinalPrice = Math.max(0, finalPrice - refundAmount);
        const recalculatedPlatformFee =
          order.type === 'EXCHANGE'
            ? 0
            : Number(
                await this.feeCalculator.calculateFee(
                  order.type === 'AUCTION'
                    ? ListingType.AUCTION
                    : ListingType.DIRECT,
                  order.listing.categoryId,
                  recalculatedFinalPrice,
                  { sellerId: order.sellerId },
                ),
              );
        const recalculatedSellerRevenue = Math.max(
          0,
          recalculatedFinalPrice -
            recalculatedPlatformFee +
            shippingCost -
            sellerVerificationFee,
        );
        const recalculatedTotalAmount = Math.max(0, totalAmount - refundAmount);

        await tx.wallet.upsert({
          where: { userId: order.sellerId },
          create: {
            userId: order.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: {
            ...(fromSellerBlocked > 0
              ? { balanceBlocked: { decrement: fromSellerBlocked } }
              : {}),
            ...(fromSellerAvailable > 0
              ? { balanceAvailable: { decrement: fromSellerAvailable } }
              : {}),
          },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.sellerId } },
            amount: refundAmount,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'seller_settlement_debit',
              debitReason: 'admin-partial-refund',
              orderId: order.id,
              listingId: order.listingId,
              listingTitle: order.listing?.title ?? null,
              settlementKind: 'partial_refund_agreement',
              agreementAmount: refundAmount,
              fromSellerBlocked,
              fromSellerAvailable,
              adminNote: note ?? null,
              description: `کسر توافقی ${refundAmount.toLocaleString('fa-IR')} تومان از فروشنده (${fromSellerBlocked.toLocaleString('fa-IR')} از بلوکه + ${fromSellerAvailable.toLocaleString('fa-IR')} از موجودی آزاد) برای سفارش «${order.listing?.title ?? 'کالا'}»`,
            },
          },
        });
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: refundAmount,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: refundAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: refundAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              refundReason: 'admin-partial-refund-and-continue',
              kind: 'order-escrow',
              phase: 'buyer_refund_agreement',
              orderId: order.id,
              listingId: order.listingId,
              listingTitle: order.listing?.title ?? null,
              settlementKind: 'partial_refund_agreement',
              agreementAmount: refundAmount,
              adminNote: note ?? null,
              baseAfterCostsAndProfit: maxNegotiableRefund,
              description: `بازگشت توافقی ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول خریدار برای سفارش «${order.listing?.title ?? 'کالا'}»`,
            },
          },
        });

        const debitBreakdownFa = [
          fromSellerBlocked > 0
            ? `${fromSellerBlocked.toLocaleString('fa-IR')} تومان از بلوکه`
            : null,
          fromSellerAvailable > 0
            ? `${fromSellerAvailable.toLocaleString('fa-IR')} تومان از موجودی آزاد`
            : null,
        ]
          .filter(Boolean)
          .join(' و ');

        const buyerAgreementTicketMessage = formatTicketMessageBody([
          `برای سفارش «${order.listing?.title ?? 'کالا'}» توافق مالی ثبت شد.`,
          `مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
          `این مبلغ از طرف فروشنده/صاحب آگهی کسر شد (${debitBreakdownFa || 'جزئیات کسر ثبت شد'}) و به‌صورت توافقی به شما بازگردانده شد.`,
          note ? `توضیح ادمین: ${note}` : '',
        ].filter(Boolean));
        const sellerAgreementTicketMessage = formatTicketMessageBody([
          `برای سفارش «${order.listing?.title ?? 'کالا'}» توافق مالی ثبت شد.`,
          `جمع ${refundAmount.toLocaleString('fa-IR')} تومان از شما کسر شد: ${debitBreakdownFa || '—'}.`,
          'این مبلغ به‌صورت توافقی به کیف پول خریدار اضافه شد و سفارش ادامه پیدا می‌کند.',
          note ? `توضیح ادمین: ${note}` : '',
        ].filter(Boolean));

        const [buyerAgreementTicket, sellerAgreementTicket] = await Promise.all(
          [
            tx.ticket.create({
              data: {
                userId: order.buyerId,
                subject: buildOrderTicketSubject('توافق مالی — واریز به خریدار', order.id),
                status: 'ANSWERED',
                messages: {
                  create: {
                    senderRole: UserRole.ADMIN,
                    message: buyerAgreementTicketMessage,
                  },
                },
              },
              select: { id: true },
            }),
            tx.ticket.create({
              data: {
                userId: order.sellerId,
                subject: buildOrderTicketSubject('توافق مالی — کسر از فروشنده', order.id),
                status: 'ANSWERED',
                messages: {
                  create: {
                    senderRole: UserRole.ADMIN,
                    message: sellerAgreementTicketMessage,
                  },
                },
              },
              select: { id: true },
            }),
          ],
        );

        await tx.notification.createMany({
          data: [
            {
              userId: order.buyerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت توافق مالی ثبت شد',
              message: `برای سفارش #${order.id.slice(-6)} مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
              meta: {
                orderId: order.id,
                ticketId: buyerAgreementTicket.id,
                agreementAmount: refundAmount,
                settlementKind: 'partial_refund_agreement',
              } as Prisma.InputJsonValue,
            },
            {
              userId: order.sellerId,
              type: NotificationType.TICKET_REPLY,
              title: 'تیکت توافق مالی ثبت شد',
              message: `برای سفارش #${order.id.slice(-6)} مبلغ ${refundAmount.toLocaleString('fa-IR')} تومان از سهم فروش شما کسر شد.`,
              meta: {
                orderId: order.id,
                ticketId: sellerAgreementTicket.id,
                agreementAmount: refundAmount,
                settlementKind: 'partial_refund_agreement',
              } as Prisma.InputJsonValue,
            },
          ],
        });

        const prevInspection =
          (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
        const mergedInspection =
          order.type === 'EXCHANGE'
            ? {
                ...prevInspection,
                financeSettledAt: new Date().toISOString(),
                awaitingFinanceSettlement: false,
                financeSettlementNote: note?.trim() || null,
                lastFinancialSettlement: {
                  creditedToBuyer: refundAmount,
                  debitedFromSellerTotal: refundAmount,
                  fromSellerBlocked,
                  fromSellerAvailable,
                  settledAt: new Date().toISOString(),
                },
              }
            : undefined;

        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.VERIFIED_AT_HUB,
            finalPrice: recalculatedFinalPrice,
            platformFee: recalculatedPlatformFee,
            sellerRevenue: recalculatedSellerRevenue,
            totalAmount: recalculatedTotalAmount,
            ...(mergedInspection
              ? {
                  exchangeHubInspection:
                    mergedInspection as Prisma.InputJsonValue,
                }
              : {}),
            cancelReason: [
              `بازپرداخت جزئی: ${refundAmount} تومان`,
              `توافق: مبلغ ${refundAmount} تومان با رضایت طرفین به خریدار بازگشت داده شد`,
              `مبلغ معامله (قبل): ${finalPrice} تومان`,
              `مبلغ معامله (بعد): ${recalculatedFinalPrice} تومان`,
              `کارمزد پلتفرم (قبل): ${platformFee} تومان`,
              `کارمزد پلتفرم (بعد): ${recalculatedPlatformFee} تومان`,
              `سهم فروشنده (قبل): ${sellerRevenue} تومان`,
              `سهم فروشنده (بعد): ${recalculatedSellerRevenue} تومان`,
              note ? `توضیح: ${note}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.VERIFIED_AT_HUB,
          `بازپرداخت جزئی ${refundAmount.toLocaleString('fa-IR')} تومان اعمال شد و سفارش ادامه یافت.`,
        );
        return updated;
      }

      if (action === AdminEscrowAction.REQUEST_RETURN_FROM_BUYER) {
        const returnAddress = (dto.returnAddress ?? '').trim();
        const returnPostalCode = (dto.returnPostalCode ?? '').trim();
        if (returnAddress.length < 10) {
          throw new BadRequestException('برای مرجوعی، آدرس مقصد الزامی است');
        }
        if (returnPostalCode.length < 5) {
          throw new BadRequestException('برای مرجوعی، کدپستی مقصد الزامی است');
        }
        const updated = await tx.order.update({
          where: { id: order.id },
          data: {
            status: OrderStatus.RETURN_REQUESTED,
            cancelReason: [
              'مرجوعی مورد انتظار از خریدار',
              `آدرس مقصد: ${returnAddress}`,
              `کدپستی مقصد: ${returnPostalCode}`,
              note ? `توضیح: ${note}` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        });
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.RETURN_REQUESTED,
          'خریدار باید کالا را به آدرس اعلام‌شده مرجوع و کد رهگیری ثبت کند.',
        );
        return updated;
      }

      if (action === AdminEscrowAction.CONFIRM_RETURN_AND_REFUND) {
        if (order.status !== OrderStatus.RETURN_SHIPPED) {
          throw new BadRequestException(
            'ابتدا باید خریدار کد رهگیری مرجوعی را ثبت کرده باشد',
          );
        }
        const claimed = await tx.order.updateMany({
          where: {
            id: order.id,
            status: OrderStatus.RETURN_SHIPPED,
            returnConfirmedAt: null,
          },
          data: {
            status: OrderStatus.CANCELLED,
            cancelReason: note ?? 'مرجوعی تایید شد و بازگشت وجه انجام شد',
            returnConfirmedAt: new Date(),
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
        );

        if (sellerRevenue > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: 0,
              balanceBlocked: 0,
            },
            update: { balanceBlocked: { decrement: sellerRevenue } },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: sellerRevenue,
              type: WalletTransactionType.PENALTY,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                kind: 'order-escrow',
                phase: 'seller_blocked_debit',
                debitReason: 'confirm-return-and-refund',
                adminNote: note ?? null,
                description:
                  'کسر از موجودی بلوکه فروشنده پس از تایید مرجوعی و بازپرداخت کامل',
              },
            },
          });
        }
        if (refundableToBuyerAfterReturn > 0) {
          await tx.wallet.upsert({
            where: { userId: order.buyerId },
            create: {
              userId: order.buyerId,
              balanceAvailable: refundableToBuyerAfterReturn,
              balanceBlocked: 0,
            },
            update: {
              balanceAvailable: { increment: refundableToBuyerAfterReturn },
            },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.buyerId } },
              amount: refundableToBuyerAfterReturn,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                refundReason: 'return-confirmed-by-admin',
                adminNote: note ?? null,
                shippingCostExcluded: shippingCost,
                verificationFeeExcluded: verificationChargedToBuyer,
              },
            },
          });
        }
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.CANCELLED,
          note ?? 'مرجوعی تایید شد و مبلغ به خریدار بازگشت.',
        );
        return tx.order.findUniqueOrThrow({ where: { id: order.id } });
      }

      if (action === AdminEscrowAction.RELEASE_TO_SELLER) {
        // در معاوضه، هنگام برگشت وجه به فروشنده در کنسلی/اختلاف،
        // مبلغ قابل آزادسازی باید دقیقاً برابر سهم نهایی فروشنده باشد
        // (پس از هر اصلاح مالی در کارشناسی)، نه totalAmount.
        const refundableToSeller =
          order.type === 'EXCHANGE'
            ? Math.max(0, sellerRevenue)
            : sellerRevenue;
        if (refundableToSeller > 0) {
          await tx.wallet.upsert({
            where: { userId: order.sellerId },
            create: {
              userId: order.sellerId,
              balanceAvailable: refundableToSeller,
              balanceBlocked: 0,
            },
            update: {
              balanceBlocked: { decrement: refundableToSeller },
              balanceAvailable: { increment: refundableToSeller },
            },
          });
          await tx.walletTransaction.create({
            data: {
              wallet: { connect: { userId: order.sellerId } },
              amount: refundableToSeller,
              type: WalletTransactionType.UNBLOCK,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: order.id,
              meta: {
                description:
                  order.type === 'EXCHANGE'
                    ? 'برگشت وجه به فروشنده (بدون عودت کارشناسی) توسط ادمین'
                    : 'آزادسازی دستی وجه بلوکه سفارش توسط ادمین',
                adminNote: note ?? null,
              },
            },
          });
        }

        const prevReleaseSeller = order.status;
        const updated = await tx.order.update({
          where: { id: order.id },
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
          prevReleaseSeller,
          'SUCCESS',
        );
        await this.notifyParties(
          order.buyerId,
          order.sellerId,
          order.id,
          OrderStatus.COMPLETED,
          note ?? 'تسویه دستی سفارش توسط ادمین انجام شد',
        );
        return updated;
      }

      if (
        action === AdminEscrowAction.REFUND_TO_BUYER &&
        order.status === OrderStatus.REJECTED_AT_HUB &&
        !(dto.returnTrackingCode ?? '').trim()
      ) {
        throw new BadRequestException(
          'در لغو پس از رد کارشناسی، کد رهگیری برگشت به فروشنده اجباری است',
        );
      }

      if (sellerRevenue > 0) {
        await tx.wallet.upsert({
          where: { userId: order.sellerId },
          create: {
            userId: order.sellerId,
            balanceAvailable: 0,
            balanceBlocked: 0,
          },
          update: { balanceBlocked: { decrement: sellerRevenue } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.sellerId } },
            amount: sellerRevenue,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              kind: 'order-escrow',
              phase: 'seller_blocked_debit',
              debitReason: 'admin-manual-refund',
              adminNote: note ?? null,
              description:
                'کسر از موجودی بلوکه فروشنده به‌دلیل بازپرداخت کامل به خریدار',
            },
          },
        });
      }
      const isInspectionReturnFlow =
        order.status === OrderStatus.REJECTED_AT_HUB;
      const buyerRefundAmount = isInspectionReturnFlow
        ? refundableToBuyerAfterReturn
        : totalAmount;

      if (buyerRefundAmount > 0) {
        await tx.wallet.upsert({
          where: { userId: order.buyerId },
          create: {
            userId: order.buyerId,
            balanceAvailable: buyerRefundAmount,
            balanceBlocked: 0,
          },
          update: { balanceAvailable: { increment: buyerRefundAmount } },
        });
        await tx.walletTransaction.create({
          data: {
            wallet: { connect: { userId: order.buyerId } },
            amount: buyerRefundAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: order.id,
            meta: {
              refundReason: 'admin-manual-refund',
              adminNote: note ?? null,
              ...(isInspectionReturnFlow
                ? {
                    shippingCostExcluded: shippingCost,
                    verificationFeeExcluded: verificationChargedToBuyer,
                  }
                : {}),
            },
          },
        });
      }

      const prevManualCancel = order.status;
      const updated = await tx.order.update({
        where: { id: order.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason:
            order.status === OrderStatus.REJECTED_AT_HUB
              ? [
                  note ?? 'لغو پس از رد کارشناسی',
                  `کد رهگیری برگشت به فروشنده: ${(dto.returnTrackingCode ?? '').trim()}`,
                ].join('\n')
              : (note ?? 'لغو دستی توسط ادمین'),
          returnTrackingCode:
            order.status === OrderStatus.REJECTED_AT_HUB
              ? (dto.returnTrackingCode ?? '').trim()
              : order.returnTrackingCode,
          returnShippedAt:
            order.status === OrderStatus.REJECTED_AT_HUB
              ? new Date()
              : undefined,
          returnConfirmedAt:
            order.status === OrderStatus.RETURN_SHIPPED
              ? new Date()
              : undefined,
        },
      });
      let manualRefundReputationOpts:
        | { failurePenalizeUserIds: string[] }
        | undefined = undefined;
      if (order.type === 'EXCHANGE') {
        const hi =
          (order.exchangeHubInspection as Record<string, unknown> | null) ?? {};
        const ids: string[] = [];
        if (hi['listingItem'] === 'FAIL') ids.push(order.sellerId);
        if (hi['offerItem'] === 'FAIL') ids.push(order.buyerId);
        if (ids.length > 0)
          manualRefundReputationOpts = { failurePenalizeUserIds: ids };
      }
      await this.orderReputation.recordTerminalOutcome(
        tx,
        {
          id: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          tradeReputationAt: order.tradeReputationAt,
        },
        prevManualCancel,
        'FAILURE',
        manualRefundReputationOpts,
      );
      await tx.listing.update({
        where: { id: order.listingId },
        data: { status: ListingStatus.APPROVED },
      });

      const cancelReasonForBuyer =
        note?.trim() ||
        (order.status === OrderStatus.REJECTED_AT_HUB
          ? 'کالا در کارشناسی هاب رد شد'
          : 'سفارش توسط ادمین لغو شد');
      const buyerTicketMessage = formatTicketMessageBody([
        `سفارش «${order.listing?.title ?? 'کالا'}» لغو شد.`,
        `علت: ${cancelReasonForBuyer}`,
        `مبلغ ${buyerRefundAmount.toLocaleString('fa-IR')} تومان به کیف پول شما اضافه شد.`,
      ]);
      const buyerTicket = await tx.ticket.create({
        data: {
          userId: order.buyerId,
          subject: buildOrderTicketSubject('لغو سفارش — بازگشت وجه', order.id),
          status: 'ANSWERED',
          messages: {
            create: {
              senderRole: UserRole.ADMIN,
              message: buyerTicketMessage,
            },
          },
        },
        select: { id: true },
      });
      await tx.notification.create({
        data: {
          userId: order.buyerId,
          type: NotificationType.TICKET_REPLY,
          title: 'تیکت لغو سفارش ثبت شد',
          message: `برای سفارش #${order.id.slice(-6)} تیکت ثبت شد و مبلغ به کیف پول شما برگشت.`,
          meta: {
            orderId: order.id,
            ticketId: buyerTicket.id,
          } as Prisma.InputJsonValue,
        },
      });

      await this.notifyParties(
        order.buyerId,
        order.sellerId,
        order.id,
        OrderStatus.CANCELLED,
        note ?? 'لغو دستی سفارش و بازگشت وجه توسط ادمین انجام شد',
      );
      return updated;
    });
  }

  private buildDirectHubInspectionRejectionMessaging(opts: {
    listingTitle: string;
    orderShortId: string;
    normalizedNote: string;
    listingUrl: string;
    packagingVideoUrl: string | null;
    buyerPackagingVideoUrl: string | null;
    trackingCodes: { seller: string | null; exchangePeer: string | null };
    isExchangeListing: boolean;
  }): {
    sellerTicketBody: string;
    buyerTicketBody: string;
    sellerTicketNotifyPreview: string;
    buyerTicketNotifyPreview: string;
    sellerPushSummary: string;
    buyerPushSummary: string;
  } {
    const appendix = [
      '─── جزئیات فنی و ارجاعات ───',
      `سفارش: #${opts.orderShortId}`,
      `کالا / آگهی: ${opts.listingTitle}`,
      `لینک آگهی: ${opts.listingUrl}`,
      `کد رهگیری ثبت‌شده فروشنده: ${opts.trackingCodes.seller ?? 'ثبت نشده'}`,
      opts.isExchangeListing
        ? `کد رهگیری طرف مقابل (معاوضه، در صورت ثبت): ${opts.trackingCodes.exchangePeer ?? 'ثبت نشده'}`
        : null,
      opts.packagingVideoUrl
        ? `ویدیوی بسته‌بندی فروشنده: ${opts.packagingVideoUrl}`
        : null,
      opts.buyerPackagingVideoUrl
        ? `ویدیوی بسته‌بندی خریدار یا طرف مقابل: ${opts.buyerPackagingVideoUrl}`
        : null,
      `خلاصهٔ دلیل کارشناسی: ${opts.normalizedNote}`,
    ]
      .filter(Boolean)
      .join('\n');

    const penaltyExample = `${TRADE_REPUTATION_PENALTY_DELTA}`.replace('.', '٫');

    const sellerTicketBody = formatTicketMessageBody([
      `کالای مربوط به سفارش شمارهٔ #${opts.orderShortId} (${opts.listingTitle}) از نظر کارشناسی فنی مرکز طبقه رد شده است. هرگونه دل‌آزردگی طرف خریدار و شما برایمان مهم است و از تأخیر در تجربه‌ای که انتظار داشتید خلاف آن بود، معذرت می‌خواهیم.`,
      `شرح دلیل کارشناسی (ثبت شده توسط تیم فنی):\n«${opts.normalizedNote}»`,
      'سفارش اکنون در وضعیت «رد شده در هاب» است. از همین پیام رسمی پیگیری انجام می‌شود؛ لطفاً برای هماهنگی مرجوعی و تسویه، همین مسیر پیام‌ها را پیگیری کنید.',
      'هم‌زمان، آگهی مربوطه از انتشار موقت خارج می‌شود تا بتوانید نقص‌ها را با شفافیت بیشتر اصلاح و پس از اصلاح دوباره در «آگهی‌های من» ارسال کنید.',
      `پس از بسته‌شدن قطعی همین پرونده و لغو رسمی از سمت طبقه، تأثیر منفی قانونی بر امتیاز معاملاتی حساب شما اعمال خواهد شد؛ طبق قوانین فعلی تا حدود ${penaltyExample} واحد کسر برای چنین رسیدگی قطعی پیش‌بینی شده است.`,
      appendix,
    ]);

    const buyerTicketBody = formatTicketMessageBody([
      `از پیش‌آمد تجربه‌ای که انتظار داشتید با کارشناسی فنی تأیید شود خلاف شده، پوزش می‌خواهیم.`,
      `دلیلی که مرکز کارشناسی طبقه برای این سفارش ثبت کرده است:\n«${opts.normalizedNote}»`,
      `سفارش شمارهٔ #${opts.orderShortId} مربوط به «${opts.listingTitle}» در وضعیت «رد شده در هاب» قرار می‌گیرد. پشتیبانی طبقه مرجوعی رسمی را با هر دو طرف هماهنگ کرده؛ پس از تکمیل رسیدگی و قطعی‌شدن لغو رسمی مطابق ضوابط، بازگشت مبلغ پرداخت‌شده به کیف پول شما (یا مسیر تأییدشده قبلی)، طبق پل انتخاب رسمی پیام می‌شود و از همین تیکت هر پرسشی را دارید بازمی‌کنید.`,
      `بر اساس ارزیابی کیفیت معامله، تأثیر قانونی احتمالی بر امتیاز معاملاتی فروشندگان خاطی نیز تنها بعد از قطعی‌شدن پرونده رسمی پیگیری می‌شود.`,
      appendix,
    ]);

    return {
      sellerTicketBody,
      buyerTicketBody,
      sellerTicketNotifyPreview: `تیکت رسمی رد کارشناسی برای سفارش #${opts.orderShortId}. لطفاً از همان مسیر پیام پاسخ دهید؛ هماهنگی مرجوعی، تسویه و تأثیر بر امتیاز معاملاتی پس از قطعی‌شدن پرونده، از همین تیکت پیش می‌رود.`,
      buyerTicketNotifyPreview: `تیکت رسمی باز شد: دلیل رد کارشناسی و هماهنگی بازپرداخت برای سفارش #${opts.orderShortId}. پوزش؛ لطفاً برای پیگیری دقیق، از همین پیام رسمی کمک بگیرید.`,
      sellerPushSummary: `کارشناسی سفارش #${opts.orderShortId} رد شد؛ تیکت رسمی با توضیح و مراحل بعدی باز است. هماهنگی مرجوعی و تأثیر بر امتیاز معاملاتی پس از قطعی‌لغو، از همین مسیر.`,
      buyerPushSummary: `از عدم تأیید فنی برای سفارش #${opts.orderShortId} پوزش می‌خواهیم؛ تیکت رسمی با جزئیات دلیل و مسیر بازپرداخت باز است؛ پشتیبانی مرجوعی و عودت را هماهنگ می‌کند.`,
    };
  }

  private async notifyHubInspectionRejectedPartiesPush(
    buyerId: string,
    sellerId: string,
    orderId: string,
    buyerMessage: string,
    sellerMessage: string,
  ): Promise<void> {
    const label =
      STATUS_LABELS[OrderStatus.REJECTED_AT_HUB] ?? 'رد شده در هاب';
    const titleBase = `وضعیت سفارش: ${label}`;
    await this.prisma.notification.createMany({
      data: [
        {
          userId: buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: titleBase,
          message: buyerMessage,
          meta: {
            orderId,
            status: OrderStatus.REJECTED_AT_HUB,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: titleBase,
          message: sellerMessage,
          meta: {
            orderId,
            status: OrderStatus.REJECTED_AT_HUB,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  private async notifyParties(
    buyerId: string,
    sellerId: string,
    orderId: string,
    status: OrderStatus,
    note?: string,
  ): Promise<void> {
    const label = STATUS_LABELS[status] ?? status;
    const title = `وضعیت سفارش تغییر کرد`;
    const message = note
      ? `وضعیت سفارش به «${label}» تغییر یافت. توضیح: ${note}`
      : `وضعیت سفارش به «${label}» تغییر یافت.`;
    await this.prisma.notification.createMany({
      data: [
        {
          userId: buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title,
          message,
          meta: {
            orderId,
            status,
            note,
            audience: 'BUYER',
          } as Prisma.InputJsonValue,
        },
        {
          userId: sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title,
          message,
          meta: {
            orderId,
            status,
            note,
            audience: 'SELLER',
          } as Prisma.InputJsonValue,
        },
      ],
    });
  }

  private async readExchangeNoShipmentCompensationPercent(): Promise<number> {
    const setting = await this.prisma.systemSetting.findFirst({
      where: { key: 'EXCHANGE_NO_SHIPMENT_COMPENSATION' },
    });
    const parsed = Number(setting?.value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 20;
    }
    return Math.min(100, Math.floor(parsed));
  }
}

const STATUS_LABELS: Partial<Record<OrderStatus, string>> = {
  PENDING: 'در انتظار',
  AWAITING_PAYMENT: 'در انتظار پرداخت',
  PAID: 'پرداخت شد',
  AWAITING_SHIPMENT_TO_HUB: 'در انتظار ارسال به هاب',
  SHIPPED_TO_HUB: 'ارسال شده به هاب',
  RECEIVED_AT_HUB: 'تحویل هاب شد',
  CHECKING_AT_HUB: 'در حال بررسی در هاب',
  VERIFIED_AT_HUB: 'تایید در هاب',
  REJECTED_AT_HUB: 'رد شده در هاب',
  SHIPPED_TO_BUYER: 'ارسال به خریدار',
  SHIPPED: 'ارسال شد',
  DELIVERED: 'تحویل داده شد',
  RETURN_REQUESTED: 'در انتظار ثبت مرجوعی خریدار',
  RETURN_SHIPPED: 'مرجوعی توسط خریدار ارسال شد',
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};
