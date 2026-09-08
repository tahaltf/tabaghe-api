import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingStatus,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import { NotificationService } from '../../../notification/notification.service';
import {
  ADMIN_UNPAID_CANCEL_REASON,
  isListingSoldUnpaidCancelReason,
  isUnpaidOrderStatus,
  LISTING_CAPACITY_BLOCKING_ORDER_STATUSES,
  LISTING_SOLD_UNPAID_CANCEL_REASON,
  listingUnavailableForUnpaidOrder,
  USER_UNPAID_CANCEL_REASON,
} from '../../../../common/order/unpaid-order.util';

export type UnpaidCancelSource =
  | 'user'
  | 'admin'
  | 'listing_sold_job';

@Injectable()
export class OrdersUnpaidCancelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly stateMachine: OrdersStateMachineService,
    private readonly notificationService: NotificationService,
  ) {}

  async isOrderUnpaid(
    orderId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    const prisma = tx ?? this.prisma;
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
      },
    });
    if (!order) return false;
    if (!isUnpaidOrderStatus(order.status)) return false;
    const presence = await this.walletService.getPurchaseEscrowPresence(
      order.id,
      {
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingId: order.listingId,
        tx,
      },
    );
    return !presence.buyerPaid && !presence.sellerBlocked;
  }

  async shouldCancelUnpaidOrderBecauseListingUnavailable(
    order: {
      id: string;
      buyerId: string;
      listingId: string;
      status: OrderStatus;
      type: OrderType;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (!isUnpaidOrderStatus(order.status)) return false;
    if (order.type === OrderType.EXCHANGE) return false;
    const prisma = tx ?? this.prisma;
    const listing = await prisma.listing.findUnique({
      where: { id: order.listingId },
      select: { status: true, stockQuantity: true },
    });
    if (!listing) return false;
    if (listingUnavailableForUnpaidOrder(listing)) return true;

    const stockCapacity = Math.max(1, listing.stockQuantity ?? 1);
    if (stockCapacity > 1) {
      const activeCount = await prisma.order.count({
        where: {
          listingId: order.listingId,
          id: { not: order.id },
          status: { in: [...LISTING_CAPACITY_BLOCKING_ORDER_STATUSES] },
        },
      });
      return activeCount >= stockCapacity;
    }

    const blockingOrder = await prisma.order.findFirst({
      where: {
        listingId: order.listingId,
        id: { not: order.id },
        buyerId: { not: order.buyerId },
        status: {
          notIn: [
            OrderStatus.PENDING,
            OrderStatus.CANCELLED,
            OrderStatus.COMPLETED,
          ],
        },
      },
      select: { id: true },
    });
    return Boolean(blockingOrder);
  }

  async cancelUnpaidOrder(params: {
    orderId: string;
    reason?: string;
    source: UnpaidCancelSource;
    actorUserId?: string;
  }) {
    const existing = await this.prisma.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        type: true,
        listingId: true,
        listing: { select: { id: true, title: true, status: true } },
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');

    if (
      existing.status === OrderStatus.CANCELLED ||
      existing.status === OrderStatus.COMPLETED
    ) {
      return existing;
    }

    if (params.source === 'user') {
      if (params.actorUserId !== existing.buyerId) {
        throw new ForbiddenException('فقط خریدار می‌تواند این سفارش را لغو کند');
      }
    }

    if (!isUnpaidOrderStatus(existing.status)) {
      throw new BadRequestException(
        'فقط سفارش‌های در انتظار پرداخت (بدون تراکنش) قابل لغو از این مسیر هستند',
      );
    }

    const unpaid = await this.isOrderUnpaid(existing.id);
    if (!unpaid) {
      throw new BadRequestException(
        'برای این سفارش پرداخت ثبت شده است؛ لغو باید از مسیر بازگشت وجه انجام شود',
      );
    }

    this.stateMachine.assertTransition(
      existing.status,
      OrderStatus.CANCELLED,
      `unpaid-cancel-${params.source}`,
    );

    const cancelReason = this.resolveCancelReason(params.reason, params.source);

    const updated = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.update({
        where: { id: existing.id },
        data: {
          status: OrderStatus.CANCELLED,
          cancelReason,
        },
      });

      if (existing.listing.status !== ListingStatus.SOLD) {
        const stillBlocked = await tx.order.findFirst({
          where: {
            listingId: existing.listingId,
            status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] },
            id: { not: existing.id },
          },
          select: { id: true },
        });
        const paidActive = await tx.order.findFirst({
          where: {
            listingId: existing.listingId,
            status: {
              notIn: [
                OrderStatus.PENDING,
                OrderStatus.AWAITING_PAYMENT,
                OrderStatus.CANCELLED,
              ],
            },
          },
          select: { id: true },
        });
        if (!stillBlocked && !paidActive) {
          await tx.listing.update({
            where: { id: existing.listingId },
            data: { status: ListingStatus.APPROVED },
          });
        }
      }

      return order;
    });

    const listingTitle = existing.listing.title?.trim() || 'کالا';
    const notifyMessage = isListingSoldUnpaidCancelReason(cancelReason)
      ? `سفارش «${listingTitle}» لغو شد؛ این کالا قبلاً به فروش رفته است.`
      : `سفارش «${listingTitle}» بدون پرداخت لغو شد.`;

    await this.notificationService
      .create({
        userId: existing.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'لغو سفارش',
        message: notifyMessage,
        meta: {
          orderId: existing.id,
          listingId: existing.listingId,
          status: OrderStatus.CANCELLED,
          phase: 'unpaid_cancelled',
        },
      })
      .catch(() => undefined);

    return updated;
  }

  async cancelUnpaidOrdersForUnavailableListings(limit = 50): Promise<number> {
    const candidates = await this.prisma.order.findMany({
      where: {
        status: { in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT] },
        type: { in: [OrderType.DIRECT, OrderType.AUCTION] },
      },
      select: {
        id: true,
        buyerId: true,
        listingId: true,
        status: true,
        type: true,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let cancelled = 0;
    for (const order of candidates) {
      try {
        const shouldCancel =
          await this.shouldCancelUnpaidOrderBecauseListingUnavailable(order);
        if (!shouldCancel) continue;
        await this.cancelUnpaidOrder({
          orderId: order.id,
          source: 'listing_sold_job',
          reason: LISTING_SOLD_UNPAID_CANCEL_REASON,
        });
        cancelled += 1;
      } catch (error) {
        console.error(
          `Error auto-canceling unpaid order ${order.id} for sold listing:`,
          error,
        );
      }
    }
    return cancelled;
  }

  private resolveCancelReason(
    reason: string | undefined,
    source: UnpaidCancelSource,
  ): string {
    const normalized = reason?.trim();
    if (normalized) return normalized;
    if (source === 'user') return USER_UNPAID_CANCEL_REASON;
    if (source === 'admin') return ADMIN_UNPAID_CANCEL_REASON;
    return LISTING_SOLD_UNPAID_CANCEL_REASON;
  }
}
