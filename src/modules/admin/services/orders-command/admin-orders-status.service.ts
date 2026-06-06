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

import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { OrderReputationService } from '../../../orders/order-reputation.service';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersService } from '../../../orders/orders.service';
import { OrdersStateMachineService } from '../../../orders/orders-state-machine.service';
import { enrichOrderUpdateForCompletion } from '../../../orders/order-lifecycle.util';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import {
  buildOrderTicketSubject,
  formatTicketMessageBody,
} from '../../../../common/ticket-message.util';
import { AdminOrdersNotifyService } from './admin-orders-notify.service';
import { OperationalNotifyService } from '../../../notification/operational-notify.service';

@Injectable()
export class AdminOrdersStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appSettings: AppSettingsService,
    private readonly orderReputation: OrderReputationService,
    private readonly walletService: WalletService,
    private readonly ordersService: OrdersService,
    private readonly listingCommand: ListingCommandService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notify: AdminOrdersNotifyService,
    private readonly operationalNotify: OperationalNotifyService,
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
      (existing.status === OrderStatus.COMPLETED ||
        existing.status === OrderStatus.CANCELLED) &&
      status !== existing.status
    ) {
      throw new BadRequestException(
        'سفارش در وضعیت نهایی است و قابل تغییر نیست',
      );
    }

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

      const hubRejectCopy = this.notify.buildDirectHubInspectionRejectionMessaging({
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
                role: 'SELLER',
                phase: 'hub_inspection_rejected',
                phaseKey: 'hub_inspection_rejected',
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
                role: 'BUYER',
                phase: 'hub_inspection_rejected',
                phaseKey: 'hub_inspection_rejected',
              } as Prisma.InputJsonValue,
            },
          ],
        });

        await this.notify.notifyHubInspectionRejectedPartiesPush(
          existing.buyerId,
          existing.sellerId,
          id,
          hubRejectCopy.buyerPushSummary,
          hubRejectCopy.sellerPushSummary,
        );

        await this.listingCommand.rejectAfterTradeFailure(tx, {
          listingId: existing.listing.id,
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
          await this.walletService.debitOrderScopedBlocked(tx, {
            userId: existing.sellerId,
            orderId: existing.id,
            listingId: existing.listing.id,
            requestedAmount: sellerRevenue,
            referenceId: existing.id,
            penaltyMeta: {
              kind: 'order-escrow',
              phase: 'seller_blocked_debit',
              debitReason: 'admin-status-cancelled',
              orderId: existing.id,
              listingId: existing.listing.id,
              adminNote: normalizedNote ?? null,
              description:
                'کسر از موجودی بلوکه فروشنده به‌دلیل لغو سفارش و بازگشت وجه خریدار',
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

        await this.notify.notifyParties(
          existing.buyerId,
          existing.sellerId,
          existing.id,
          OrderStatus.CANCELLED,
          normalizedNote ?? 'لغو سفارش و بازگشت وجه انجام شد',
          { orderType: existing.type },
        );

        return updatedOrder;
      });
    }

    if (existing.status !== status) {
      this.stateMachine.assertTransition(
        existing.status,
        status,
        'admin-update-status',
      );
    }

    const order = await this.prisma.$transaction(async (tx) => {
      if (status === OrderStatus.COMPLETED) {
        await this.applyAdminCompletionSideEffects(tx, existing);
      }

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
    const isExchangeInspectionStart =
      existing.type === 'EXCHANGE' &&
      status === OrderStatus.CHECKING_AT_HUB &&
      existing.status !== OrderStatus.CHECKING_AT_HUB;
    const isOrderCompleted =
      status === OrderStatus.COMPLETED &&
      existing.status !== OrderStatus.COMPLETED;
    if (isExchangeInspectionStart) {
      await this.operationalNotify.notifyExchangeHubInspectionStarted({
        orderId: id,
        buyerId: existing.buyerId,
        sellerId: existing.sellerId,
        listingId: existing.listingId,
        note,
      });
    } else if (isOrderCompleted) {
      await this.operationalNotify.notifyOrderCompleted({
        orderId: id,
        buyerId: existing.buyerId,
        sellerId: existing.sellerId,
        listingId: existing.listingId,
        orderType: existing.type,
      });
    } else {
      await this.notify.notifyParties(
        existing.buyerId,
        existing.sellerId,
        id,
        status,
        note,
        { orderType: existing.type },
      );
    }
    return order;
  }

  private async applyAdminCompletionSideEffects(
    tx: Prisma.TransactionClient,
    existing: {
      id: string;
      buyerId: string;
      sellerId: string;
      listingId: string;
      sellerRevenue: unknown;
      type: string;
    },
  ): Promise<void> {
    if (existing.type === 'EXCHANGE') {
      const [sellerRelease, buyerRelease] = await Promise.all([
        this.walletService.getOrderScopedBlockedAmount(tx, {
          userId: existing.sellerId,
          orderId: existing.id,
          listingId: existing.listingId,
        }),
        this.walletService.getOrderScopedBlockedAmount(tx, {
          userId: existing.buyerId,
          orderId: existing.id,
          listingId: existing.listingId,
        }),
      ]);
      if (sellerRelease > 0) {
        await this.walletService.releaseEscrow(
          existing.sellerId,
          sellerRelease,
          existing.listingId,
          tx,
          { orderId: existing.id },
        );
      }
      if (buyerRelease > 0) {
        await this.walletService.releaseEscrow(
          existing.buyerId,
          buyerRelease,
          existing.listingId,
          tx,
          { orderId: existing.id },
        );
      }
      return;
    }

    const sellerRelease = await this.walletService.resolveOrderScopedCap(tx, {
      userId: existing.sellerId,
      orderId: existing.id,
      listingId: existing.listingId,
      requestedAmount: Number(existing.sellerRevenue),
    });
    if (sellerRelease > 0) {
      await this.walletService.releaseEscrow(
        existing.sellerId,
        sellerRelease,
        existing.listingId,
        tx,
        { orderId: existing.id },
      );
    }
  }
}
