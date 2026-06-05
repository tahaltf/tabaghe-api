import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  Prisma,
  UserRole,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';

import { AdminEscrowAction, ResolveOrderEscrowDto } from '../../dto/admin-order.dto';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { enrichOrderUpdateForCompletion } from '../../../orders/order-lifecycle.util';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';
import { OperationalNotifyService } from '../../../notification/operational-notify.service';

@Injectable()
export class AdminOrdersEscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly listingCommand: ListingCommandService,
    private readonly notify: AdminOrdersNotifyService,
    private readonly operationalNotify: OperationalNotifyService,
  ) {}

  async resolveEscrow(id: string, dto: ResolveOrderEscrowDto) {
    const postTxNotifies: Array<() => Promise<void>> = [];
    const result = await this.prisma.$transaction(async (tx) => {
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
          await this.walletService.refundExchangeExtraOnCancel(tx, {
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            listingId: order.listingId,
            orderId: order.id,
            isPayerMe: Boolean(exchangeOffer?.isPayerMe),
            buyerRefundable: exchangeBuyerRefundable,
            sellerRefundable: exchangeSellerRefundable,
          });
        } else if (sellerRevenue > 0) {
          await this.walletService.debitOrderScopedBlocked(tx, {
            userId: order.sellerId,
            orderId: order.id,
            listingId: order.listingId,
            requestedAmount: sellerRevenue,
            referenceId: order.id,
            penaltyMeta: {
              kind: 'exchange-cancel-both-rejected',
              orderId: order.id,
              listingId: order.listingId,
              description:
                'لغو معاوضه پس از رد هر دو کالا؛ کسر سهم بلوکه فروشنده',
              adminNote: note ?? null,
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

        postTxNotifies.push(async () => {
          await this.operationalNotify.notifyExchangeBothRejectedCancel({
            orderId: order.id,
            listingId: order.listingId,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            note:
              note ??
              'هر دو کالا رد شد؛ معامله لغو و مرجوعی برای هر دو طرف ثبت شد.',
          });
          await this.operationalNotify.notifyExchangeHubOutboundShipped({
            orderId: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            listingId: order.listingId,
            leg: 'TO_BUYER',
            status: OrderStatus.CANCELLED,
            trackingCode: returnToBuyer,
            isReturn: true,
            note: note ?? undefined,
          });
          await this.operationalNotify.notifyExchangeHubOutboundShipped({
            orderId: order.id,
            buyerId: order.buyerId,
            sellerId: order.sellerId,
            listingId: order.listingId,
            leg: 'TO_SELLER',
            status: OrderStatus.CANCELLED,
            trackingCode: returnToSeller,
            isReturn: true,
            note: note ?? undefined,
          });
        });

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
        await this.notify.notifyParties(
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
          select: { balanceAvailable: true },
        });
        const orderScopedBlocked =
          await this.walletService.getOrderScopedBlockedAmount(tx, {
            userId: order.sellerId,
            orderId: order.id,
            listingId: order.listingId,
          });
        const sellerAvailableNow = Number(sellerWallet?.balanceAvailable ?? 0);
        const fromSellerBlocked = Math.min(refundAmount, orderScopedBlocked);
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

        if (order.type !== 'EXCHANGE') {
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
        }

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
        if (order.type === 'EXCHANGE') {
          const orderShortId = order.id.slice(-6);
          postTxNotifies.push(async () => {
            await this.operationalNotify.notifyExchangeHubInspectionFinancialSettlement(
              {
                orderId: order.id,
                buyerId: order.buyerId,
                sellerId: order.sellerId,
                listingId: order.listingId,
                orderShortId,
              },
            );
            await this.operationalNotify.notifyExchangeHubInspectionTickets({
              orderId: order.id,
              buyerId: order.buyerId,
              sellerId: order.sellerId,
              buyerTicketId: buyerAgreementTicket.id,
              sellerTicketId: sellerAgreementTicket.id,
              orderShortId,
              kind: 'financial_settlement',
            });
          });
        } else {
          await this.notify.notifyParties(
            order.buyerId,
            order.sellerId,
            order.id,
            OrderStatus.VERIFIED_AT_HUB,
            `بازپرداخت جزئی ${refundAmount.toLocaleString('fa-IR')} تومان اعمال شد و سفارش ادامه یافت.`,
          );
        }
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
        await this.notify.notifyParties(
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
          await this.walletService.debitOrderScopedBlocked(tx, {
            userId: order.sellerId,
            orderId: order.id,
            listingId: order.listingId,
            requestedAmount: sellerRevenue,
            referenceId: order.id,
            penaltyMeta: {
              kind: 'order-escrow',
              phase: 'seller_blocked_debit',
              debitReason: 'confirm-return-and-refund',
              orderId: order.id,
              listingId: order.listingId,
              adminNote: note ?? null,
              description:
                'کسر از موجودی بلوکه فروشنده پس از تایید مرجوعی و بازپرداخت کامل',
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
        await this.notify.notifyParties(
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
          const toRelease = await this.walletService.resolveOrderScopedCap(tx, {
            userId: order.sellerId,
            orderId: order.id,
            listingId: order.listingId,
            requestedAmount: refundableToSeller,
          });
          if (toRelease > 0) {
            await this.walletService.releaseEscrow(
              order.sellerId,
              toRelease,
              order.listingId,
              tx,
              { orderId: order.id },
            );
          }
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
        await this.operationalNotify.notifyOrderCompleted({
          orderId: order.id,
          buyerId: order.buyerId,
          sellerId: order.sellerId,
          listingId: order.listingId,
          orderType: order.type,
        });
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
        await this.walletService.debitOrderScopedBlocked(tx, {
          userId: order.sellerId,
          orderId: order.id,
          listingId: order.listingId,
          requestedAmount: sellerRevenue,
          referenceId: order.id,
          penaltyMeta: {
            kind: 'order-escrow',
            phase: 'seller_blocked_debit',
            debitReason: 'admin-manual-refund',
            orderId: order.id,
            listingId: order.listingId,
            adminNote: note ?? null,
            description:
              'کسر از موجودی بلوکه فروشنده به‌دلیل بازپرداخت کامل به خریدار',
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

      await this.notify.notifyParties(
        order.buyerId,
        order.sellerId,
        order.id,
        OrderStatus.CANCELLED,
        note ?? 'لغو دستی سفارش و بازگشت وجه توسط ادمین انجام شد',
      );
      return updated;
    });
    for (const notify of postTxNotifies) {
      await notify().catch(() => undefined);
    }
    return result;
  }
}
