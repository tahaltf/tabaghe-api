import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  NotificationType,
  OrderStatus,
  OrderType,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { readPositiveIntSetting } from '../../../../common/system-settings/numeric-setting.util';
import { reconcileExchangeOfferStatusWithOrder } from '../../exchange-order-sync.util';
import { OrdersSchedulerService } from '../scheduler/orders-scheduler.service';
import { OrdersCompletionService } from '../command/orders-completion.service';
import { ORDER_DETAIL_INCLUDE } from './order-detail.include';
import { OrdersResponseEnrichmentService } from './orders-response-enrichment.service';
import { isHubOutboundShipmentNotificationMeta } from '../../../../common/order/hub-shipment-note.util';

const DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES = 72 * 60;
const DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES = 24 * 60;
const DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS = 24;

@Injectable()
export class OrdersDetailQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: OrdersResponseEnrichmentService,
    private readonly scheduler: OrdersSchedulerService,
    private readonly completion: OrdersCompletionService,
  ) {}

  async getOrderById(userId: string, orderId: string) {
    let order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: ORDER_DETAIL_INCLUDE,
    });

    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.buyerId !== userId && order.sellerId !== userId) {
      throw new ForbiddenException('عدم دسترسی');
    }

    order = await this.enrichment.attachBuyerConfirmDeadline(order);

    if (order.status === OrderStatus.RETURN_SHIPPED) {
      await this.ensureReturnConfirmDeadline(orderId);
      const returnTiming = await this.prisma.order.findUnique({
        where: { id: orderId },
        select: {
          returnConfirmDeadline: true,
          returnShippedAt: true,
          returnPackagingVideo: true,
          returnTrackingCode: true,
        },
      });
      if (returnTiming) {
        order = { ...order, ...returnTiming };
      }
    }

    const autoReturnConfirmed =
      await this.completion.tryAutoConfirmSellerReturnReceipt(orderId);
    if (autoReturnConfirmed) {
      const refreshedAfterReturn = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: ORDER_DETAIL_INCLUDE,
      });
      if (refreshedAfterReturn) {
        order = await this.enrichment.attachBuyerConfirmDeadline(
          refreshedAfterReturn,
        );
      }
    }

    const autoConfirmed =
      await this.scheduler.tryAutoConfirmExpiredOrder(orderId);
    if (autoConfirmed) {
      const refreshedAfterConfirm = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: ORDER_DETAIL_INCLUDE,
      });
      if (refreshedAfterConfirm) {
        order = await this.enrichment.attachBuyerConfirmDeadline(
          refreshedAfterConfirm,
        );
      }
    }

    const shippingCancelled =
      await this.scheduler.tryCancelExpiredShippingForOrder(orderId);
    if (shippingCancelled) {
      const refreshed = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: ORDER_DETAIL_INCLUDE,
      });
      if (refreshed) {
        order = await this.enrichment.attachBuyerConfirmDeadline(refreshed);
      }
    }

    if (order.type === 'EXCHANGE' && order.exchangeOfferId) {
      await this.prisma.$transaction((tx) =>
        reconcileExchangeOfferStatusWithOrder(tx, order.exchangeOfferId!),
      );

      const exchangeOffer = await this.prisma.exchangeOffer.findUnique({
        where: { id: order.exchangeOfferId },
        select: {
          id: true,
          title: true,
          description: true,
          images: true,
          extraPayment: true,
          isPayerMe: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      (order as Record<string, unknown>).exchangeOffer = exchangeOffer;
      if (
        exchangeOffer &&
        (order.status === OrderStatus.PENDING ||
          order.status === OrderStatus.AWAITING_PAYMENT)
      ) {
        const paymentDeadlineMinutes =
          await this.getExchangePaymentDeadlineMinutes();
        const base = exchangeOffer.updatedAt ?? order.createdAt;
        (order as Record<string, unknown>).exchangePaymentDeadline = new Date(
          base.getTime() + paymentDeadlineMinutes * 60_000,
        );
      }
      if (exchangeOffer) {
        const verification = Number(order.verificationFee || 0);
        const extra = Number(exchangeOffer.extraPayment || 0);
        const buyerDue = verification + (exchangeOffer.isPayerMe ? extra : 0);
        const sellerDue = verification + (!exchangeOffer.isPayerMe ? extra : 0);
        const paidTotal = Number(order.totalAmount || 0);

        const buyerMarkedPaid = Boolean(order.shippingAddress);
        const sellerMarkedPaid = Boolean(order.sellerShippingAddress);
        const bothSidesMarked = buyerMarkedPaid && sellerMarkedPaid;

        const buyerPaid = bothSidesMarked
          ? buyerDue
          : buyerMarkedPaid
            ? Math.min(buyerDue, paidTotal)
            : 0;
        const sellerPaid = bothSidesMarked
          ? sellerDue
          : sellerMarkedPaid
            ? Math.min(sellerDue, paidTotal)
            : 0;

        (order as Record<string, unknown>).exchangeEscrow = {
          buyerDue,
          sellerDue,
          buyerPaid,
          sellerPaid,
          buyerBlocked: Math.max(0, buyerDue - buyerPaid),
          sellerBlocked: Math.max(0, sellerDue - sellerPaid),
          totalDue: buyerDue + sellerDue,
          totalPaid: paidTotal,
        };
      }
    }

    let exchangePaymentSources: {
      buyer: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
      seller: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
    } | null = null;
    if (order.type === OrderType.EXCHANGE) {
      const inferred: {
        buyer: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
        seller: 'GATEWAY' | 'WALLET' | 'UNKNOWN';
      } = {
        buyer: 'WALLET',
        seller: 'WALLET',
      };
      const settlements = await this.prisma.walletTransaction.findMany({
        where: {
          wallet: {
            userId: { in: [order.buyerId, order.sellerId] },
          },
          AND: [
            { type: WalletTransactionType.SETTLEMENT },
            { status: WalletTransactionStatus.SUCCESS },
            { meta: { path: ['kind'], equals: 'order-escrow' } },
            {
              OR: [
                { meta: { path: ['orderId'], equals: order.id } },
                { meta: { path: ['listingId'], equals: order.listingId } },
              ],
            },
          ],
        },
        select: {
          wallet: { select: { userId: true } },
          meta: true,
        },
      });
      for (const tx of settlements) {
        const meta = (tx.meta as Record<string, unknown> | null) ?? {};
        const src = String(meta['paymentSource'] ?? '').toUpperCase();
        const mapped: 'GATEWAY' | 'WALLET' | null =
          src === 'GATEWAY' ? 'GATEWAY' : src === 'WALLET' ? 'WALLET' : null;
        if (!mapped) continue;
        if (tx.wallet.userId === order.buyerId) inferred.buyer = mapped;
        if (tx.wallet.userId === order.sellerId) inferred.seller = mapped;
      }
      exchangePaymentSources = inferred;
      (order as Record<string, unknown>).exchangePaymentSources =
        exchangePaymentSources;
    }

    if (order.status === OrderStatus.REJECTED_AT_HUB) {
      const relatedTicket = await this.prisma.ticket.findFirst({
        where: {
          userId,
          OR: [
            { subject: { contains: `[ORDER:${orderId}]` } },
            { subject: { contains: orderId.slice(-6) } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      (order as Record<string, unknown>).supportTicketId =
        relatedTicket?.id ?? null;
    }

    const isSellerView = order.sellerId === userId;
    const isBuyerView = order.buyerId === userId;

    let hubShipmentNote: string | null = null;
    let hubShipmentNotedAt: Date | null = null;
    const skipHubShipmentNoteForExchangeReject =
      order.type === OrderType.EXCHANGE &&
      order.status === OrderStatus.REJECTED_AT_HUB;
    try {
      if (!skipHubShipmentNoteForExchangeReject) {
        const noteCandidates = await this.prisma.notification.findMany({
          where: {
            userId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            meta: {
              path: ['orderId'],
              equals: orderId,
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 15,
          select: { meta: true, createdAt: true },
        });

        const hubShipmentNotification =
          noteCandidates.find((n) => {
            const meta = (n.meta as Record<string, unknown> | null) ?? {};
            const audience = meta['audience'];
            if (audience === 'BUYER' && !isBuyerView) return false;
            if (audience === 'SELLER' && !isSellerView) return false;
            return isHubOutboundShipmentNotificationMeta(meta);
          }) ?? null;

        const hubShipmentNoteRaw = (
          hubShipmentNotification?.meta as Record<string, unknown> | null
        )?.['note'];
        hubShipmentNote =
          typeof hubShipmentNoteRaw === 'string' &&
          hubShipmentNoteRaw.trim().length > 0
            ? hubShipmentNoteRaw.trim()
            : null;
        hubShipmentNotedAt = hubShipmentNotification?.createdAt ?? null;
      }
    } catch {
      hubShipmentNote = null;
      hubShipmentNotedAt = null;
    }
    if (hubShipmentNote) {
      (order as Record<string, unknown>).hubShipmentNote = hubShipmentNote;
      (order as Record<string, unknown>).hubShipmentNotedAt = hubShipmentNotedAt;
    }

    const needsHub = order.requiresVerification || order.type === 'EXCHANGE';

    const contactReleased =
      order.status === 'SHIPPED' ||
      order.status === OrderStatus.SHIPPED_TO_BUYER ||
      order.status === 'DELIVERED' ||
      order.status === 'COMPLETED' ||
      order.status === 'DISPUTED' ||
      order.status === OrderStatus.RETURN_REQUESTED ||
      order.status === OrderStatus.RETURN_SHIPPED;

    const stripPhone = (u: { phone?: string | null } | null) =>
      u ? { ...u, phone: contactReleased ? u.phone : null } : u;

    if (order.buyer)
      order.buyer = stripPhone(order.buyer) as typeof order.buyer;
    if (order.seller)
      order.seller = stripPhone(order.seller) as typeof order.seller;

    if (needsHub && isSellerView) {
      const hubAddress =
        order.platformAddress || 'تهران، دفتر مرکزی پردازش و کارشناسی طبقه';
      const maskedOrder: Record<string, unknown> = {
        ...order,
        buyer: order.buyer
          ? {
              id: order.buyer.id,
              firstName: 'خریدار',
              lastName: '',
              avatar: null,
              phone: null,
            }
          : null,
      };
      maskedOrder.shippingAddress = {
        fullAddress: hubAddress,
        city: 'تهران',
        province: 'تهران',
        postalCode: '1111111111',
        phone: '021-00000000',
      };
      maskedOrder.isMaskedForVerification = true;
      return this.enrichment.attachBuyerConfirmDeadline(
        maskedOrder as typeof order,
      );
    }

    if (isBuyerView) {
      const cloned: Record<string, unknown> = { ...order };
      cloned.platformFee = undefined;
      cloned.sellerRevenue = undefined;
      cloned.sellerShippingCost = undefined;
      return this.enrichment.attachBuyerConfirmDeadline(
        cloned as typeof order,
      );
    }

    return this.enrichment.attachBuyerConfirmDeadline(order);
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

    const minutes = await this.getSellerReturnConfirmDeadlineMinutes();
    const base = order.returnShippedAt ?? new Date();
    const returnConfirmDeadline = new Date(
      base.getTime() + minutes * 60 * 1000,
    );
    await this.prisma.order.update({
      where: { id: orderId },
      data: { returnConfirmDeadline },
    });
  }

  private async getSellerReturnConfirmDeadlineMinutes(): Promise<number> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            'SELLER_RETURN_CONFIRM_DEADLINE_MINUTES',
            'SELLER_RETURN_CONFIRM_DEADLINE_HOURS',
          ],
        },
      },
    });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const fallback = DEFAULT_SELLER_RETURN_CONFIRM_DEADLINE_MINUTES;
    const minutesRow =
      byKey.get('SELLER_RETURN_CONFIRM_DEADLINE_MINUTES')?.value?.trim();
    if (minutesRow) {
      const minutes = Number(minutesRow.replace(/[^\d.]/g, ''));
      if (Number.isFinite(minutes) && minutes > 0) {
        return Math.floor(minutes);
      }
    }
    const hoursRow =
      byKey.get('SELLER_RETURN_CONFIRM_DEADLINE_HOURS')?.value?.trim();
    if (hoursRow) {
      const hours = Number(hoursRow.replace(/[^\d.]/g, ''));
      if (Number.isFinite(hours) && hours > 0) {
        return Math.floor(hours * 60);
      }
    }
    return fallback;
  }

  private async getExchangePaymentDeadlineMinutes(): Promise<number> {
    const minutesSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES' },
      select: { value: true },
    });
    if (minutesSetting?.value?.trim()) {
      return this.parsePositiveIntSetting(
        minutesSetting.value,
        DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES,
      );
    }
    const hours = await readPositiveIntSetting(
      this.prisma,
      'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS',
      DEFAULT_EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS,
    );
    return hours * 60;
  }

  private parsePositiveIntSetting(
    value: string | null | undefined,
    fallback: number,
  ): number {
    const parsed = Number(value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.floor(parsed);
  }
}
