import { Injectable } from '@nestjs/common';
import { NotificationType, OrderStatus, OrderType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
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
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
      phase: 'exchange_hub_item_received',
    };

    if (params.side === 'LISTING') {
      await this.notifyMany([
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای شما در انبار',
          message: `کالای آگهی شما برای معاوضه «${listingTitle}» در انبار طبقه دریافت و ثبت شد.`,
          meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER', leg: 'LISTING' },
        },
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای آگهی در انبار',
          message: `کالای آگهی (طرف فروشنده) برای معاوضه «${listingTitle}» در انبار دریافت شد.`,
          meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER', leg: 'LISTING' },
        },
      ]);
    } else {
      await this.notifyMany([
        {
          userId: params.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای شما در انبار',
          message: `کالای پیشنهادی شما برای معاوضه «${listingTitle}» در انبار طبقه دریافت و ثبت شد.`,
          meta: { ...baseMeta, role: 'BUYER', audience: 'BUYER', leg: 'OFFER' },
        },
        {
          userId: params.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'دریافت کالای پیشنهادی در انبار',
          message: `کالای پیشنهادی (طرف خریدار) برای معاوضه «${listingTitle}» در انبار دریافت شد.`,
          meta: { ...baseMeta, role: 'SELLER', audience: 'SELLER', leg: 'OFFER' },
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
    const baseMeta = {
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      status: params.status,
      trackingCode: tracking || undefined,
      phase: params.isReturn
        ? 'exchange_hub_return_outbound'
        : 'exchange_hub_outbound_shipped',
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
          role: 'BUYER',
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
  }): Promise<void> {
    const listingTitle = await this.listingTitle(params.listingId);
    await this.notifyMany([
      {
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کالا از انبار برای شما ارسال شد',
        message: `کالای «${listingTitle}» از انبار طبقه برای شما ارسال شد. پس از دریافت، تأیید را ثبت کنید.`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.SHIPPED_TO_BUYER,
          phase: 'shipped_from_hub_to_buyer',
          role: 'BUYER',
        },
      },
      {
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ارسال از انبار به خریدار',
        message: `کالای «${listingTitle}» از انبار برای خریدار ارسال شد.`,
        meta: {
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          status: OrderStatus.SHIPPED_TO_BUYER,
          phase: 'shipped_from_hub_to_buyer',
          role: 'SELLER',
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
    await this.notificationService.create({
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
      },
    });
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

    if (sellerSent && buyerSent) {
      const message = `هر دو طرف ارسال معاوضه «${listingTitle}» را ثبت کردند. پس از دریافت در انبار، کارشناسی آغاز می‌شود.`;
      await this.notifyMany([
        {
          userId: order.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ثبت ارسال هر دو طرف',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            listingTitle,
            status: order.status,
            phase: 'exchange_both_shipped',
            role: 'BUYER',
          },
        },
        {
          userId: order.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ثبت ارسال هر دو طرف',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            listingTitle,
            status: order.status,
            phase: 'exchange_both_shipped',
            role: 'SELLER',
          },
        },
      ]);
      return;
    }

    await this.notifyMany([
      {
        userId: shipperUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ثبت ارسال شما',
        message: `ارسال شما برای معاوضه «${listingTitle}» ثبت شد. منتظر ارسال طرف مقابل هستیم.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: order.status,
          phase: 'exchange_self_shipped',
        },
      },
      {
        userId: peerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'طرف مقابل ارسال کرد — ارسال شما',
        message: `طرف مقابل برای معاوضه «${listingTitle}» ارسال را ثبت کرده است. لطفاً تا پایان مهلت، ارسال خود را ثبت کنید.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          listingTitle,
          status: order.status,
          phase: 'exchange_peer_must_ship',
          shipperUserId,
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
