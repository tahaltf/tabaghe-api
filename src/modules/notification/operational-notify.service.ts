import { Injectable } from '@nestjs/common';
import { NotificationType, OrderStatus, OrderType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  buildExchangeFinancialSettlementNotifyMessage,
  buildExchangeFinancialSettlementTicketNotifyMessage,
  EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE,
} from '../../common/order/exchange-financial-settlement-messaging.util';
import {
  ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA,
  ORDER_STATUS_LABELS_FA,
} from '../../common/order/order-status-labels.util';
import { NotificationService } from './notification.service';

type NotifyPayload = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  meta?: Record<string, unknown>;
};

@Injectable()
export class OperationalNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async notifyMany(items: NotifyPayload[]): Promise<void> {
    if (!items.length) return;
    await Promise.all(
      items.map((item) =>
        this.notificationService.create({
          ...item,
          forceSiteNotification: true,
          recipientRole:
            item.meta?.role != null
              ? String(item.meta.role)
              : item.meta?.audience != null
                ? String(item.meta.audience)
                : undefined,
        }),
      ),
    );
  }

  /** ثبت دریافت یکی از کالاهای معاوضه در انبار (ادمین) */
  async notifyExchangeHubItemReceived(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    side: 'LISTING' | 'OFFER';
    bothReceived: boolean;
    status: OrderStatus | string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const listingPhase = 'exchange_hub_listing_received';
    const offerPhase = 'exchange_hub_offer_received';
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
    };
    const sellerListingNote =
      'کالای آگهی شما در انبار طبقه دریافت و ثبت شد.';
    const buyerListingPeerNote =
      'کالای آگهی فروشنده در انبار طبقه دریافت شد.';
    const buyerOfferNote =
      'کالای پیشنهادی شما در انبار طبقه دریافت و ثبت شد.';
    const sellerOfferPeerNote =
      'کالای پیشنهادی خریدار در انبار طبقه دریافت شد.';

    if (params.side === 'LISTING') {
      await this.notifyMany([
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای شما در انبار',
          message: `کالای آگهی شما برای معاوضه «${listingTitle}» در انبار طبقه دریافت و ثبت شد.`,
          meta: {
            ...baseMeta,
            phase: listingPhase,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'LISTING',
            note: sellerListingNote,
          },
        },
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای آگهی در انبار',
          message: `کالای آگهی فروشنده برای معاوضه «${listingTitle}» در انبار طبقه دریافت شد.`,
          meta: {
            ...baseMeta,
            phase: listingPhase,
            role: 'BUYER',
            audience: 'BUYER',
            leg: 'LISTING',
            note: buyerListingPeerNote,
          },
        },
      ]);
    } else {
      await this.notifyMany([
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای شما در انبار',
          message: `کالای پیشنهادی شما برای معاوضه «${listingTitle}» در انبار طبقه دریافت و ثبت شد.`,
          meta: {
            ...baseMeta,
            phase: offerPhase,
            role: 'BUYER',
            audience: 'BUYER',
            leg: 'OFFER',
            note: buyerOfferNote,
          },
        },
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای پیشنهادی در انبار',
          message: `کالای پیشنهادی خریدار برای معاوضه «${listingTitle}» در انبار طبقه دریافت شد.`,
          meta: {
            ...baseMeta,
            phase: offerPhase,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'OFFER',
            note: sellerOfferPeerNote,
          },
        },
      ]);
    }

    if (params.bothReceived) {
      const bothMessage = `هر دو کالای معاوضه «${listingTitle}» در انبار دریافت شدند. پس از شروع کارشناسی از همین مسیر مطلع می‌شوید.`;
      await this.notifyMany([
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'هر دو کالا در انبار',
          message: bothMessage,
          meta: {
            ...baseMeta,
            role: 'BUYER',
            audience: 'BUYER',
            phase: 'exchange_hub_both_received',
          },
        },
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'هر دو کالا در انبار',
          message: bothMessage,
          meta: {
            ...baseMeta,
            role: 'SELLER',
            audience: 'SELLER',
            phase: 'exchange_hub_both_received',
          },
        },
      ]);
    }
  }

  /** شروع کارشناسی هر دو کالای معاوضه در هاب (ادمین) */
  async notifyExchangeHubInspectionStarted(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const status = OrderStatus.CHECKING_AT_HUB;
    const statusLabel =
      ORDER_STATUS_LABELS_FA[status] ?? 'در حال بررسی در هاب';
    const noteSuffix = params.note?.trim()
      ? ` توضیح: ${params.note.trim()}`
      : '';
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      statusFa: statusLabel,
      orderStatusLabel: statusLabel,
      phase: 'exchange_hub_inspection_started',
    };
    const inspectionNote = 'کارشناسی فنی کالاها در مرکز طبقه آغاز شد.';
    const message = `کارشناسی فنی معاوضه «${listingTitle}» در مرکز طبقه آغاز شد. پس از اعلام نتیجه از همین مسیر مطلع می‌شوید.${noteSuffix}`;

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'شروع کارشناسی در هاب',
        message,
        meta: {
          ...baseMeta,
          role: 'BUYER',
          audience: 'BUYER',
          note: inspectionNote,
        },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'شروع کارشناسی در هاب',
        message,
        meta: {
          ...baseMeta,
          role: 'SELLER',
          audience: 'SELLER',
          note: inspectionNote,
        },
      },
    ]);
  }

  /** تکمیل نهایی معامله / سفارش */
  async notifyOrderCompleted(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    orderType: OrderType | string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const status = OrderStatus.COMPLETED;
    const statusLabel = ORDER_STATUS_LABELS_FA[status] ?? 'تکمیل شد';
    const isExchange = params.orderType === OrderType.EXCHANGE;
    const message = isExchange
      ? `معاوضه «${listingTitle}» با موفقیت تکمیل شد. از همراهی شما در طبقه سپاسگزاریم.`
      : `سفارش «${listingTitle}» با موفقیت تکمیل شد.`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      statusFa: statusLabel,
      orderStatusLabel: statusLabel,
      phase: 'order_completed',
      phaseKey: 'order_completed',
      note: message,
    };

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'معامله تکمیل شد',
        message,
        meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER' },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'معامله تکمیل شد',
        message,
        meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER' },
      },
    ]);
  }

  /** نتیجه کارشناسی: هر دو کالا تایید — آماده ارسال به مقصد */
  async notifyExchangeHubInspectionVerified(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const status = OrderStatus.VERIFIED_AT_HUB;
    const statusLabel = ORDER_STATUS_LABELS_FA[status] ?? 'تایید در هاب';
    const detail =
      params.note?.trim() ||
      'هر دو کالا تایید شد و برای ارسال به مقصد نهایی آماده می‌شود.';
    const message = `کارشناسی معاوضه «${listingTitle}» تایید شد. ${detail}`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      statusFa: statusLabel,
      orderStatusLabel: statusLabel,
      phase: 'exchange_hub_inspection_verified',
      resolution: 'SHIP_TO_DESTINATIONS',
      note: detail,
    };

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'تایید کارشناسی معاوضه',
        message,
        meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER' },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'تایید کارشناسی معاوضه',
        message,
        meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER' },
      },
    ]);
  }

  /** نتیجه کارشناسی: رد — مرجوع هر دو کالا */
  async notifyExchangeHubInspectionRejected(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const status = OrderStatus.REJECTED_AT_HUB;
    const statusLabel = ORDER_STATUS_LABELS_FA[status] ?? 'رد شده در هاب';
    const detail =
      params.note?.trim() ||
      'کارشناسی معاوضه رد شد؛ کالای شما از هاب مرجوع می‌شود. جزئیات در تیکت پشتیبانی.';
    const message = `کارشناسی معاوضه «${listingTitle}» رد شد. ${detail}`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      statusFa: statusLabel,
      orderStatusLabel: statusLabel,
      phase: 'exchange_hub_inspection_rejected',
      resolution: 'RETURN_BOTH_TO_SENDERS',
      note: detail,
    };

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'رد کارشناسی معاوضه',
        message,
        meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER' },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'رد کارشناسی معاوضه',
        message,
        meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER' },
      },
    ]);
  }

  /** نتیجه کارشناسی: تایید با اصلاح مالی */
  async notifyExchangeHubInspectionFinancialSettlement(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    orderShortId: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const status = OrderStatus.VERIFIED_AT_HUB;
    const statusLabel = ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA;
    const message = buildExchangeFinancialSettlementNotifyMessage(
      params.orderShortId,
    );
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      statusFa: statusLabel,
      orderStatusLabel: statusLabel,
      phase: 'exchange_financial_settlement',
      resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP',
      settlementKind: 'exchange-financial-settlement',
      note: message,
    };

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE,
        message,
        meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER' },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE,
        message,
        meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER' },
      },
    ]);
  }

  /** در انتظار شارژ کیف پول برای تکمیل توافق مالی کارشناسی */
  async notifyExchangeHubAwaitingFinanceTopup(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    debtorUserId: string;
    shortfall: number;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const shortfallFa = params.shortfall.toLocaleString('fa-IR');
    const debtorIsSeller = params.debtorUserId === params.sellerId;
    const debtorLabel = debtorIsSeller ? 'فروشنده' : 'خریدار';
    const peerUserId = debtorIsSeller ? params.buyerId : params.sellerId;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: OrderStatus.CHECKING_AT_HUB,
      phase: 'exchange_hub_awaiting_finance_topup',
      awaitingFinanceSettlement: true,
      shortfall: params.shortfall,
    };

    await this.notifyMany([
      {
        userId: params.debtorUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'شارژ کیف پول برای ادامه معاوضه',
        message: `برای اعمال توافق مالی کارشناسی معاوضه «${listingTitle}»، ${shortfallFa} تومان به کیف پول شما نیاز است. پس از شارژ، پشتیبانی دوباره تسویه را ثبت می‌کند.`,
        meta: {
          ...baseMeta,
          role: debtorIsSeller ? 'SELLER' : 'BUYER',
          audience: debtorIsSeller ? 'SELLER' : 'BUYER',
        },
      },
      {
        userId: peerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'در انتظار تسویه مالی معاوضه',
        message: `معامله «${listingTitle}» در انتظار شارژ کیف پول ${debtorLabel} برای تکمیل توافق مالی کارشناسی است.`,
        meta: {
          ...baseMeta,
          role: debtorIsSeller ? 'BUYER' : 'SELLER',
          audience: debtorIsSeller ? 'BUYER' : 'SELLER',
        },
      },
    ]);
  }

  /** تیکت نتیجه کارشناسی معاوضه برای هر دو طرف */
  async notifyExchangeHubInspectionTickets(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    buyerTicketId: string;
    sellerTicketId: string;
    orderShortId: string;
    kind: 'return' | 'financial_settlement';
  }): Promise<void> {
    const isFinancial = params.kind === 'financial_settlement';
    const title = isFinancial
      ? 'تیکت کارشناسی معاوضه'
      : 'تیکت نتیجه کارشناسی معاوضه';
    const message = isFinancial
      ? buildExchangeFinancialSettlementTicketNotifyMessage(params.orderShortId)
      : `برای سفارش #${params.orderShortId} تیکت پشتیبانی ایجاد شد.`;

    await this.notificationService.notifyUserTickets([
      {
        userId: params.buyerId,
        ticketId: params.buyerTicketId,
        orderId: params.orderId,
        title,
        message,
      },
      {
        userId: params.sellerId,
        ticketId: params.sellerTicketId,
        orderId: params.orderId,
        title,
        message,
      },
    ]);
  }

  /** ارسال خروجی یکی از مرسوله‌های معاوضه از انبار (ادمین) */
  async notifyExchangeHubOutboundShipped(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    leg: 'TO_BUYER' | 'TO_SELLER';
    status: OrderStatus | string;
    trackingCode: string;
    note?: string;
    isReturn?: boolean;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const tracking = params.trackingCode.trim();
    const noteSuffix = params.note?.trim()
      ? ` توضیح: ${params.note.trim()}`
      : '';
    const trackingSuffix = tracking ? ` کد رهگیری: ${tracking}.` : '';
    const phase = params.isReturn
      ? 'exchange_hub_return_outbound'
      : 'exchange_hub_outbound_shipped';
    const phaseKey = params.isReturn
      ? `exchange_hub_return_${params.leg}`
      : `exchange_hub_outbound_${params.leg}`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
      trackingCode: tracking || undefined,
      phase,
      phaseKey,
      leg: params.leg,
    };

    if (params.isReturn) {
      if (params.leg === 'TO_BUYER') {
        await this.notifyMany([
          {
            userId: params.buyerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'مرجوعی شما از انبار ثبت شد',
            message: `مرسوله مرجوعی مربوط به شما برای معاوضه «${listingTitle}» از انبار ثبت شد.${trackingSuffix}${noteSuffix}`,
            meta: {
              ...baseMeta,
              role: 'BUYER',
              audience: 'BUYER',
              leg: 'TO_BUYER',
            },
          },
          {
            userId: params.sellerId,
            type: NotificationType.ORDER_STATUS_CHANGED,
            title: 'ثبت مرجوعی طرف مقابل',
            message: `مرسوله مرجوعی خریدار برای معاوضه «${listingTitle}» از انبار ثبت شد.${trackingSuffix}${noteSuffix}`,
            meta: {
              ...baseMeta,
              role: 'SELLER',
              audience: 'SELLER',
              leg: 'TO_BUYER',
            },
          },
        ]);
        return;
      }

      await this.notifyMany([
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'مرجوعی شما از انبار ثبت شد',
          message: `مرسوله مرجوعی مربوط به شما برای معاوضه «${listingTitle}» از انبار ثبت شد.${trackingSuffix}${noteSuffix}`,
          meta: {
            ...baseMeta,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'TO_SELLER',
          },
        },
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ثبت مرجوعی طرف مقابل',
          message: `مرسوله مرجوعی فروشنده برای معاوضه «${listingTitle}» از انبار ثبت شد.${trackingSuffix}${noteSuffix}`,
          meta: {
            ...baseMeta,
            role: 'BUYER',
            audience: 'BUYER',
            leg: 'TO_SELLER',
          },
        },
      ]);
      return;
    }

    if (params.leg === 'TO_BUYER') {
      const buyerNote =
        params.note?.trim() ||
        'کالای آگهی از انبار برای شما ارسال شد و کد رهگیری ثبت گردید.';
      const sellerNote =
        params.note?.trim() ||
        'کالای آگهی شما از انبار به خریدار ارسال شد و کد رهگیری ثبت گردید.';
      await this.notifyMany([
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ارسال کالا از انبار برای شما',
          message: `کالای آگهی برای معاوضه «${listingTitle}» از انبار طبقه برای شما ارسال شد. پس از دریافت، تأیید را ثبت کنید.${trackingSuffix}${noteSuffix}`,
          meta: {
            ...baseMeta,
            role: 'BUYER',
            audience: 'BUYER',
            leg: 'TO_BUYER',
            note: buyerNote,
          },
        },
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ارسال کالای آگهی شما از انبار',
          message: `کالای آگهی شما برای معاوضه «${listingTitle}» از انبار به خریدار ارسال شد.${trackingSuffix}${noteSuffix}`,
          meta: {
            ...baseMeta,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'TO_BUYER',
            note: sellerNote,
          },
        },
      ]);
      return;
    }

    const buyerNote =
      params.note?.trim() ||
      'کالای پیشنهادی شما از انبار به فروشنده ارسال شد و کد رهگیری ثبت گردید.';
    const sellerNote =
      params.note?.trim() ||
      'کالای پیشنهادی خریدار از انبار برای شما ارسال شد و کد رهگیری ثبت گردید.';
    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ارسال کالای پیشنهادی شما از انبار',
        message: `کالای پیشنهادی شما برای معاوضه «${listingTitle}» از انبار به فروشنده ارسال شد.${trackingSuffix}${noteSuffix}`,
        meta: {
          ...baseMeta,
          role: 'BUYER',
          audience: 'BUYER',
          leg: 'TO_SELLER',
          note: buyerNote,
        },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ارسال کالا از انبار برای شما',
        message: `کالای پیشنهادی خریدار برای معاوضه «${listingTitle}» از انبار برای شما ارسال شد. پس از دریافت، تأیید را ثبت کنید.${trackingSuffix}${noteSuffix}`,
        meta: {
          ...baseMeta,
          role: 'SELLER',
          audience: 'SELLER',
          leg: 'TO_SELLER',
          note: sellerNote,
        },
      },
    ]);
  }

  private async listingTitle(listingId: string): Promise<string> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
    return listing?.title?.trim() || 'کالا';
  }

  /** خرید مستقیم / مزایده — پس از پرداخت موفق */
  async notifyPurchaseCompleted(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    type?: OrderType;
  }): Promise<void> {
    const title = await this.listingTitle(order.listingId);
    const isAuction = order.type === OrderType.AUCTION;
    await this.notifyMany([
      {
        userId: order.buyerId,
        type: NotificationType.BUY_NOW,
        title: isAuction ? 'برنده مزایده — پرداخت ثبت شد' : 'خرید شما ثبت شد',
        message: isAuction
          ? `پرداخت مزایده برای «${title}» با موفقیت ثبت شد. مراحل بعدی را در صفحه سفارش دنبال کنید.`
          : `خرید شما برای «${title}» با موفقیت ثبت شد.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle: title,
          role: 'BUYER',
          status: OrderStatus.PAID,
          phase: 'purchase_completed',
          phaseKey: 'purchase_completed',
        },
      },
      {
        userId: order.sellerId,
        type: NotificationType.BUY_NOW,
        title: isAuction ? 'مزایده شما فروخته شد' : 'کالای شما فروخته شد',
        message: isAuction
          ? `مزایده «${title}» با موفقیت پرداخت شد.`
          : `کالای «${title}» با موفقیت فروخته شد.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle: title,
          role: 'SELLER',
          status: 'SOLD',
          phase: 'sale_completed',
          phaseKey: 'sale_completed',
        },
      },
    ]);
  }

  /** تغییر وضعیت سفارش — هر دو طرف (جایگزین createMany) */
  async notifyOrderStatusToParties(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    status: OrderStatus | string;
    title: string;
    message: string;
    phase?: string;
    note?: string;
    buyerMessage?: string;
    sellerMessage?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
      phase: params.phase,
      phaseKey: params.phase ?? undefined,
      note: params.note,
    };
    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: params.title,
        message: params.buyerMessage ?? params.message,
        meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER' },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: params.title,
        message: params.sellerMessage ?? params.message,
        meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER' },
      },
    ]);
  }

  /** ثبت ارسال — فروش مستقیم / مزایده */
  async notifyDirectShipmentRegistered(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    toHub: boolean;
    newStatus: OrderStatus;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const hub = params.toHub;
    await this.notifyMany([
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: hub ? 'ارسال به انبار ثبت شد' : 'ارسال به خریدار ثبت شد',
        message: hub
          ? `ارسال «${listingTitle}» به انبار طبقه ثبت شد. پس از کارشناسی، مراحل بعدی اطلاع‌رسانی می‌شود.`
          : `ارسال «${listingTitle}» برای خریدار ثبت شد.`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: params.newStatus,
          phase: hub ? 'seller_shipped_to_hub' : 'seller_shipped_to_buyer',
          phaseKey: hub ? 'seller_shipped_to_hub' : 'seller_shipped_to_buyer',
          role: 'SELLER',
        },
      },
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: hub ? 'کالا به انبار ارسال شد' : 'کالا برای شما ارسال شد',
        message: hub
          ? `فروشنده کالای «${listingTitle}» را به انبار کارشناسی ارسال کرده است.`
          : `فروشنده کالای «${listingTitle}» را برای شما ارسال کرده است.`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: params.newStatus,
          phase: hub ? 'awaiting_hub_inspection' : 'awaiting_delivery_confirm',
          phaseKey: hub ? 'awaiting_hub_inspection' : 'awaiting_delivery_confirm',
          role: 'BUYER',
        },
      },
    ]);
  }

  /** مرجوع از هاب — فروش مستقیم / مزایده */
  async notifyDirectHubReturnShipped(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const noteSuffix = params.note?.trim()
      ? ` ${params.note.trim()}`
      : '';
    await this.notifyMany([
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'مرجوعی از هاب ثبت شد',
        message: `مرسوله شما از هاب به آدرس شما مرجوع شد.${noteSuffix}`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.REJECTED_AT_HUB,
          phase: 'hub_return_shipped',
          phaseKey: 'hub_return_shipped',
          role: 'SELLER',
          audience: 'SELLER',
          note: params.note,
        },
      },
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'مرجوعی از هاب و بازگشت وجه',
        message: `کالا از هاب به فروشنده مرجوع شد؛ مبلغ پرداختی به کیف پول شما بازگشت داده می‌شود.${noteSuffix}`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.CANCELLED,
          phase: 'admin_cancel_refund',
          phaseKey: 'admin_cancel_refund',
          role: 'BUYER',
          audience: 'BUYER',
          note: params.note,
        },
      },
    ]);
  }

  /** کارشناسی هاب — نتیجه برای هر دو طرف */
  async notifyHubInspectionOutcome(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    status: OrderStatus;
    title: string;
    buyerMessage: string;
    sellerMessage: string;
    phase: string;
  }): Promise<void> {
    await this.notifyOrderStatusToParties({
      orderId: params.orderId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingId: params.listingId,
      status: params.status,
      title: params.title,
      message: params.buyerMessage,
      buyerMessage: params.buyerMessage,
      sellerMessage: params.sellerMessage,
      phase: params.phase,
    });
  }

  /** ارسال از هاب به خریدار */
  async notifyShippedFromHubToBuyer(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const noteSuffix = params.note?.trim()
      ? ` ${params.note.trim()}`
      : '';
    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کالا از انبار برای شما ارسال شد',
        message: `کالای «${listingTitle}» از انبار طبقه برای شما ارسال شد. پس از دریافت، تأیید را ثبت کنید.${noteSuffix}`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.SHIPPED_TO_BUYER,
          phase: 'shipped_from_hub_to_buyer',
          phaseKey: 'shipped_from_hub_to_buyer',
          role: 'BUYER',
          note: params.note,
        },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ارسال از انبار به خریدار',
        message: `کالای «${listingTitle}» از انبار برای خریدار ارسال شد.${noteSuffix}`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.SHIPPED_TO_BUYER,
          phase: 'shipped_from_hub_to_buyer',
          phaseKey: 'shipped_from_hub_to_buyer',
          role: 'SELLER',
          note: params.note,
        },
      },
    ]);
  }

  /** معاوضه — پرداخت هر دو طرف، آماده ارسال */
  async notifyExchangeReadyToShip(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(order.listingId);
    const message = `پرداخت هر دو طرف برای معاوضه «${listingTitle}» تکمیل شد. لطفاً تا پایان مهلت، کالای خود را به انبار طبقه ارسال و کد رهگیری را ثبت کنید.`;
    await this.notifyMany([
      {
        userId: order.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'زمان ارسال معاوضه',
        message,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
          phase: 'exchange_ready_to_ship',
          role: 'BUYER',
          audience: 'BUYER',
        },
      },
      {
        userId: order.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'زمان ارسال معاوضه',
        message,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
          phase: 'exchange_ready_to_ship',
          role: 'SELLER',
          audience: 'SELLER',
        },
      },
    ]);
  }

  async notifyExchangeParticipantPaid(
    order: { id: string; buyerId: string; sellerId: string; listingId: string },
    payerUserId: string,
  ): Promise<void> {
    const listingTitle = await this.listingTitle(order.listingId);
    const peerUserId =
      payerUserId === order.buyerId ? order.sellerId : order.buyerId;
    const peerRole = peerUserId === order.buyerId ? 'BUYER' : 'SELLER';
    await this.notifyMany([
      {
        userId: peerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'پرداخت طرف مقابل معاوضه',
        message: `طرف مقابل سهم خود را برای معاوضه «${listingTitle}» پرداخت کرد. پس از پرداخت شما، مرحله ارسال باز می‌شود.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: OrderStatus.AWAITING_PAYMENT,
          phase: 'exchange_peer_paid',
          payerUserId,
          role: peerRole,
          audience: peerRole,
        },
      },
    ]);
  }

  async afterExchangeShipmentUpdated(
    order: {
      id: string;
      buyerId: string;
      sellerId: string;
      listingId: string;
      status: OrderStatus;
      trackingCode: string | null;
      sellerTrackingCode: string | null;
    },
    shipperUserId: string,
  ): Promise<void> {
    const listingTitle = await this.listingTitle(order.listingId);
    const sellerSent = Boolean(order.trackingCode);
    const buyerSent = Boolean(order.sellerTrackingCode);
    const peerUserId =
      shipperUserId === order.buyerId ? order.sellerId : order.buyerId;
    const shipperIsSeller = shipperUserId === order.sellerId;
    const shipperRole = shipperIsSeller ? 'SELLER' : 'BUYER';
    const peerRole = shipperIsSeller ? 'BUYER' : 'SELLER';
    const shipperLeg = shipperIsSeller ? 'LISTING' : 'OFFER';
    const peerLeg = shipperIsSeller ? 'OFFER' : 'LISTING';
    const hubStatus = order.status ?? OrderStatus.SHIPPED_TO_HUB;

    if (sellerSent && buyerSent) {
      const message = `هر دو کالای معاوضه «${listingTitle}» به انبار طبقه ارسال شدند. پس از دریافت در انبار، کارشناسی آغاز می‌شود.`;
      await this.notifyMany([
        {
          userId: order.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'هر دو کالا در راه انبار',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            listingTitle,
            status: hubStatus,
            phase: 'exchange_both_shipped',
            role: 'BUYER',
            audience: 'BUYER',
          },
        },
        {
          userId: order.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'هر دو کالا در راه انبار',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            listingTitle,
            status: hubStatus,
            phase: 'exchange_both_shipped',
            role: 'SELLER',
            audience: 'SELLER',
          },
        },
      ]);
      return;
    }

    const selfMessage = shipperIsSeller
      ? `ارسال کالای آگهی شما برای معاوضه «${listingTitle}» به انبار طبقه ثبت شد. وضعیت: در راه انبار. منتظر ارسال کالای پیشنهادی خریدار هستیم.`
      : `ارسال کالای پیشنهادی شما برای معاوضه «${listingTitle}» به انبار طبقه ثبت شد. وضعیت: در راه انبار. منتظر ارسال کالای آگهی فروشنده هستیم.`;
    const peerMessage = shipperIsSeller
      ? `فروشنده ارسال کالای آگهی را برای معاوضه «${listingTitle}» ثبت کرد. لطفاً تا پایان مهلت، کالای پیشنهادی خود را ارسال و کد رهگیری را ثبت کنید.`
      : `خریدار ارسال کالای پیشنهادی را برای معاوضه «${listingTitle}» ثبت کرد. لطفاً تا پایان مهلت، کالای آگهی خود را ارسال و کد رهگیری را ثبت کنید.`;

    await this.notifyMany([
      {
        userId: shipperUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ارسال شما به انبار ثبت شد',
        message: selfMessage,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: hubStatus,
          phase: 'exchange_self_shipped',
          leg: shipperLeg,
          role: shipperRole,
          audience: shipperRole,
        },
      },
      {
        userId: peerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'طرف مقابل ارسال کرد — نوبت شما',
        message: peerMessage,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: hubStatus,
          phase: 'exchange_peer_must_ship',
          leg: peerLeg,
          shipperUserId,
          role: peerRole,
          audience: peerRole,
        },
      },
    ]);
  }

  /** کیف پول — واریز دستی */
  async notifyWalletDepositSubmitted(
    userId: string,
    transactionId: string,
    amount: number,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: 'درخواست شارژ کیف پول ثبت شد',
      message:
        'درخواست شما ثبت شد و پس از بررسی ادمین، نتیجه اطلاع‌رسانی می‌شود.',
      meta: {
        transactionId,
        amount,
        phase: 'wallet_deposit_submitted',
      },
    });
  }

  async notifyWalletDepositResult(
    userId: string,
    transactionId: string,
    amount: number,
    approved: boolean,
    adminNote?: string,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: approved ? 'شارژ کیف پول تایید شد' : 'درخواست شارژ رد شد',
      message: approved
        ? 'درخواست شارژ شما تایید شد و مبلغ به موجودی قابل برداشت اضافه شد.'
        : adminNote
          ? `درخواست شارژ شما رد شد. دلیل: ${adminNote}`
          : 'درخواست شارژ شما توسط ادمین رد شد.',
      meta: {
        transactionId,
        amount,
        phase: approved ? 'wallet_deposit_approved' : 'wallet_deposit_rejected',
        rejectionReason: adminNote,
      },
    });
  }

  /** کیف پول — برداشت */
  async notifyWalletWithdrawSubmitted(
    userId: string,
    transactionId: string,
    amount: number,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: 'درخواست برداشت ثبت شد',
      message:
        'درخواست برداشت شما ثبت شد و پس از بررسی ادمین، نتیجه اطلاع‌رسانی می‌شود.',
      meta: {
        transactionId,
        amount,
        phase: 'wallet_withdraw_submitted',
      },
    });
  }

  async notifyWalletWithdrawResult(
    userId: string,
    transactionId: string,
    amount: number,
    approved: boolean,
    adminNote?: string,
  ): Promise<void> {
    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: approved ? 'برداشت تایید شد' : 'درخواست برداشت رد شد',
      message: approved
        ? 'درخواست برداشت شما تایید و مبلغ از کیف پول کسر شد.'
        : adminNote
          ? `درخواست برداشت رد شد و مبلغ به موجودی برگشت. دلیل: ${adminNote}`
          : 'درخواست برداشت رد شد و مبلغ به موجودی شما برگشت.',
      meta: {
        transactionId,
        amount,
        phase: approved ? 'wallet_withdraw_approved' : 'wallet_withdraw_rejected',
        rejectionReason: adminNote,
      },
    });
  }

  /** اعلان جفت‌طرفه معاوضه با متن و نقش مجزا برای خریدار/فروشنده */
  async notifyExchangePartyPair(params: {
    orderId: string | null;
    listingId?: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    phase: string;
    phaseKey: string;
    status?: OrderStatus | string;
    type?: NotificationType;
    buyer: {
      title: string;
      message: string;
      ticketId?: string;
      leg?: string;
      note?: string;
    };
    seller: {
      title: string;
      message: string;
      ticketId?: string;
      leg?: string;
      note?: string;
    };
  }): Promise<void> {
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const type = params.type ?? NotificationType.ORDER_STATUS_CHANGED;
    const status = params.status ?? OrderStatus.CANCELLED;
    const statusLabel =
      ORDER_STATUS_LABELS_FA[status as OrderStatus] ?? String(status);
    const baseMeta = {
      orderId: params.orderId ?? undefined,
      listingId: params.listingId,
      listingTitle,
      status,
      statusLabel,
      phase: params.phase,
      phaseKey: params.phaseKey,
    };

    await this.notifyMany([
      {
        userId: params.buyerId,
        type,
        title: params.buyer.title,
        message: params.buyer.message,
        meta: {
          ...baseMeta,
          role: 'BUYER',
          audience: 'BUYER',
          leg: params.buyer.leg,
          note: params.buyer.note ?? params.buyer.message,
          ...(params.buyer.ticketId ? { ticketId: params.buyer.ticketId } : {}),
        },
      },
      {
        userId: params.sellerId,
        type,
        title: params.seller.title,
        message: params.seller.message,
        meta: {
          ...baseMeta,
          role: 'SELLER',
          audience: 'SELLER',
          leg: params.seller.leg,
          note: params.seller.note ?? params.seller.message,
          ...(params.seller.ticketId ? { ticketId: params.seller.ticketId } : {}),
        },
      },
    ]);

    const ticketNotifies: Array<
      Parameters<NotificationService['notifyUserTicket']>[0]
    > = [];
    if (params.buyer.ticketId) {
      ticketNotifies.push({
        userId: params.buyerId,
        ticketId: params.buyer.ticketId,
        orderId: params.orderId ?? undefined,
        listingId: params.listingId,
        title: 'تیکت جدید ثبت شد',
        message: params.buyer.message,
      });
    }
    if (params.seller.ticketId) {
      ticketNotifies.push({
        userId: params.sellerId,
        ticketId: params.seller.ticketId,
        orderId: params.orderId ?? undefined,
        listingId: params.listingId,
        title: 'تیکت جدید ثبت شد',
        message: params.seller.message,
      });
    }
    if (ticketNotifies.length) {
      await this.notificationService.notifyUserTickets(ticketNotifies);
    }
  }

  /** لغو معاوضه به‌دلیل اتمام مهلت پرداخت */
  async notifyExchangePaymentTimeoutCancel(params: {
    orderId: string | null;
    listingId?: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    buyerCompliant: boolean;
    sellerCompliant: boolean;
    buyerTicketId: string;
    sellerTicketId: string;
  }): Promise<void> {
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    await this.notifyExchangePartyPair({
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      phase: 'exchange_payment_timeout_cancel',
      phaseKey: 'exchange_payment_timeout_cancel',
      status: OrderStatus.CANCELLED,
      buyer: {
        title: params.buyerCompliant
          ? 'معاوضه لغو شد — بازگشت وجه'
          : 'معاوضه لغو شد — مهلت پرداخت',
        message: params.buyerCompliant
          ? `معاوضه برای «${listingTitle}» لغو شد. سهم پرداختی شما به کیف پول برگشت؛ بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.`
          : `معاوضه برای «${listingTitle}» به‌دلیل عدم تکمیل پرداخت شما در مهلت مقرر لغو شد.`,
        ticketId: params.buyerTicketId,
        leg: 'OFFER',
      },
      seller: {
        title: params.sellerCompliant
          ? 'معاوضه لغو شد — بازگشت وجه'
          : 'معاوضه لغو شد — مهلت پرداخت',
        message: params.sellerCompliant
          ? `معاوضه برای «${listingTitle}» لغو شد. سهم پرداختی شما به کیف پول برگشت؛ بابت ناراحتی پیش‌آمده پوزش می‌خواهیم.`
          : `معاوضه برای «${listingTitle}» به‌دلیل عدم تکمیل پرداخت شما در مهلت مقرر لغو شد.`,
        ticketId: params.sellerTicketId,
        leg: 'LISTING',
      },
    });
  }

  /** لغو معاوضه — عدم ارسال هر دو طرف */
  async notifyExchangeBothNoShipmentCancel(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    shortId: string;
    penaltyPerParty: number;
    penaltyPct: number;
    buyerRefundAmount: number;
    sellerRefundAmount: number;
    buyerTicketId: string;
    sellerTicketId: string;
  }): Promise<void> {
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const buildMessage = (refund: number) =>
      params.penaltyPerParty > 0
        ? `معاوضه #${params.shortId} لغو شد. ${Math.max(0, refund).toLocaleString('fa-IR')} تومان پس از کسر ${params.penaltyPct}٪ جریمه کارشناسی به کیف پول شما واریز شد.`
        : `معاوضه #${params.shortId} به‌دلیل عدم ارسال هر دو طرف لغو شد و سهم پرداختی شما به کیف پول برگشت.`;

    await this.notifyExchangePartyPair({
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      phase: 'exchange_both_no_shipment_cancel',
      phaseKey: 'exchange_both_no_shipment_cancel',
      status: OrderStatus.CANCELLED,
      buyer: {
        title: 'معاوضه لغو شد — بازگشت وجه',
        message: buildMessage(params.buyerRefundAmount),
        ticketId: params.buyerTicketId,
        leg: 'OFFER',
      },
      seller: {
        title: 'معاوضه لغو شد — بازگشت وجه',
        message: buildMessage(params.sellerRefundAmount),
        ticketId: params.sellerTicketId,
        leg: 'LISTING',
      },
    });
  }

  /** لغو معاوضه — یک طرف ارسال کرده، طرف دیگر نکرده */
  async notifyExchangeOneSideNoShipmentCancel(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    listingTitle: string;
    buyerIsSender: boolean;
    buyerTicketId: string;
    sellerTicketId: string;
  }): Promise<void> {
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    await this.notifyExchangePartyPair({
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      phase: 'exchange_one_side_no_shipment_cancel',
      phaseKey: 'exchange_one_side_no_shipment_cancel',
      status: OrderStatus.CANCELLED,
      buyer: {
        title: params.buyerIsSender
          ? 'معاوضه لغو شد — بازگشت وجه و مرجوع کالا'
          : 'معاوضه لغو شد — کسر امتیاز',
        message: params.buyerIsSender
          ? `معامله «${listingTitle}» لغو شد؛ وجه شما برگشت و کالای پیشنهادی شما بدون کارشناسی در صف مرجوع از هاب است.`
          : `معامله «${listingTitle}» به‌دلیل عدم ارسال کالای پیشنهادی شما در مهلت لغو شد.`,
        ticketId: params.buyerTicketId,
        leg: 'OFFER',
      },
      seller: {
        title: params.buyerIsSender
          ? 'معاوضه لغو شد — کسر امتیاز'
          : 'معاوضه لغو شد — بازگشت وجه و مرجوع کالا',
        message: params.buyerIsSender
          ? `معامله «${listingTitle}» به‌دلیل عدم ارسال کالای آگهی شما در مهلت لغو شد.`
          : `معامله «${listingTitle}» لغو شد؛ وجه شما برگشت و کالای آگهی شما بدون کارشناسی در صف مرجوع از هاب است.`,
        ticketId: params.sellerTicketId,
        leg: 'LISTING',
      },
    });
  }

  /** فعال‌سازی مجدد پیشنهادهای معاوضه در صف پس از لغو به‌دلیل مهلت پرداخت */
  async notifyExchangeWaitlistRestored(params: {
    listingId: string;
    listingTitle: string;
    userIds: string[];
  }): Promise<void> {
    if (!params.userIds.length) return;
    const listingTitle = params.listingTitle?.trim() || 'کالا';
    const message = `مهلت پرداخت معاوضه برای «${listingTitle}» به پایان رسید. پیشنهاد شما دوباره فعال شد و فروشنده می‌تواند یکی از درخواست‌ها را انتخاب کند.`;
    await Promise.all(
      params.userIds.map((userId) =>
        this.notificationService.create({
          userId,
          type: NotificationType.SYSTEM,
          title: 'پیشنهاد شما دوباره در انتظار بررسی است',
          message,
          forceSiteNotification: true,
          recipientRole: 'OFFERER',
          meta: {
            listingId: params.listingId,
            listingTitle,
            phase: 'exchange_waitlist_restore',
            phaseKey: 'exchange_waitlist_restore',
            role: 'OFFERER',
            audience: 'OFFERER',
          },
        }),
      ),
    );
  }

  /** آزادسازی خودکار وجه مرجوعی پس از پایان مهلت تایید دریافت */
  async notifyExchangeAutoReturnEscrowReleased(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const message =
      'با پایان مهلت تایید دریافت و نبود اختلاف فعال، سهم پرداختی شما (بدون هزینه کارشناسی) آزاد شد.';
    await this.notifyExchangePartyPair({
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      phase: 'exchange_auto_return_escrow_released',
      phaseKey: 'exchange_auto_return_escrow_released',
      status: OrderStatus.CANCELLED,
      buyer: {
        title: 'آزادسازی خودکار وجه مرجوعی',
        message,
        leg: 'OFFER',
      },
      seller: {
        title: 'آزادسازی خودکار وجه مرجوعی',
        message,
        leg: 'LISTING',
      },
    });
  }

  /** تایید دریافت مرجوعی یکی از طرفین (جریان RETURN_BOTH) */
  async notifyExchangeReturnLegConfirmed(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    confirmedBy: 'BUYER' | 'SELLER';
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const leg = params.confirmedBy === 'BUYER' ? 'TO_BUYER' : 'TO_SELLER';
    const phaseKey = `exchange_return_leg_confirmed_${leg}`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: OrderStatus.CANCELLED,
      phase: 'exchange_return_leg_confirmed',
      phaseKey,
      leg,
    };

    if (params.confirmedBy === 'BUYER') {
      await this.notifyMany([
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'تایید دریافت مرجوعی خریدار',
          message: `خریدار دریافت مرجوعی کالای پیشنهادی خود برای معاوضه «${listingTitle}» را تایید کرد.`,
          meta: {
            ...baseMeta,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'OFFER',
          },
        },
      ]);
      return;
    }

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'تایید دریافت مرجوعی فروشنده',
        message: `فروشنده دریافت مرجوعی کالای آگهی خود برای معاوضه «${listingTitle}» را تایید کرد.`,
        meta: {
          ...baseMeta,
          role: 'BUYER',
          audience: 'BUYER',
          leg: 'LISTING',
        },
      },
    ]);
  }

  /** تایید دریافت یکی از کالاها توسط یک طرف (هنوز معامله تکمیل نشده) */
  async notifyExchangeLegDeliveryConfirmed(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    confirmedBy: 'BUYER' | 'SELLER';
    status: OrderStatus | string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const leg = params.confirmedBy === 'BUYER' ? 'TO_BUYER' : 'TO_SELLER';
    const phaseKey = `exchange_leg_delivery_confirmed_${leg}`;
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
      phase: 'exchange_leg_delivery_confirmed',
      phaseKey,
      leg,
    };

    if (params.confirmedBy === 'BUYER') {
      await this.notifyMany([
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'تایید دریافت کالای آگهی',
          message: `خریدار دریافت کالای آگهی شما برای معاوضه «${listingTitle}» را تایید کرد.`,
          meta: {
            ...baseMeta,
            role: 'SELLER',
            audience: 'SELLER',
            leg: 'LISTING',
          },
        },
      ]);
      return;
    }

    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'تایید دریافت کالای پیشنهادی',
        message: `فروشنده دریافت کالای پیشنهادی شما برای معاوضه «${listingTitle}» را تایید کرد.`,
        meta: {
          ...baseMeta,
          role: 'BUYER',
          audience: 'BUYER',
          leg: 'OFFER',
        },
      },
    ]);
  }

  /** لغو معاوضه پس از رد هر دو کالا در کارشناسی */
  async notifyExchangeBothRejectedCancel(params: {
    orderId: string;
    listingId: string;
    buyerId: string;
    sellerId: string;
    note?: string;
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    const detail =
      params.note?.trim() ||
      'هر دو کالا رد شد؛ معامله لغو و مرجوعی برای هر دو طرف ثبت شد.';
    await this.notifyExchangePartyPair({
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingTitle,
      phase: 'exchange_both_rejected_cancel',
      phaseKey: 'exchange_both_rejected_cancel',
      status: OrderStatus.CANCELLED,
      buyer: {
        title: 'لغو معاوضه — رد هر دو کالا',
        message: `معاوضه «${listingTitle}» لغو شد. کالای پیشنهادی شما و کالای آگهی رد شدند. ${detail}`,
        leg: 'OFFER',
      },
      seller: {
        title: 'لغو معاوضه — رد هر دو کالا',
        message: `معاوضه «${listingTitle}» لغو شد. کالای آگهی شما و کالای پیشنهادی خریدار رد شدند. ${detail}`,
        leg: 'LISTING',
      },
    });
  }

  /** تراکنش کیف پول عمومی (واریز درگاه، بازگشت وجه، ...) */
  async notifyWalletActivity(
    userId: string,
    params: {
      title: string;
      message: string;
      amount?: number;
      phase: string;
      orderId?: string;
      listingId?: string;
    },
  ): Promise<void> {
    const listingTitle = params.listingId
      ? await this.listingTitle(params.listingId)
      : undefined;
    await this.notificationService.create({
      userId,
      type: NotificationType.SYSTEM,
      title: params.title,
      message: params.message,
      meta: {
        ...params,
        listingTitle,
        amount: params.amount,
      },
    });
  }
}
