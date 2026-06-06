import { Injectable } from '@nestjs/common';
import { NotificationType, OrderStatus } from '@prisma/client';
import { NotificationService } from '../../../notification/notification.service';
import { formatTicketMessageBody } from '../../../../common/ticket-message.util';
import { TRADE_REPUTATION_PENALTY_DELTA } from '../../../orders/order-reputation.service';
import { STATUS_LABELS } from '../admin-orders.constants';
import { ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA } from '../../../../common/order/order-status-labels.util';

export type AdminOrderNotifyOptions = {
  statusLabel?: string;
  metaExtras?: Record<string, unknown>;
  /** عنوان اعلان؛ در غیر این صورت «وضعیت سفارش تغییر کرد» */
  title?: string;
  /** متن یکسان خریدار و فروشنده؛ در صورت تنظیم، قالب پیش‌فرض با note استفاده نمی‌شود */
  message?: string;
};

@Injectable()
export class AdminOrdersNotifyService {
  constructor(private readonly notifications: NotificationService) {}

  buildDirectHubInspectionRejectionMessaging(opts: {
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

  async notifyHubInspectionRejectedPartiesPush(
    buyerId: string,
    sellerId: string,
    orderId: string,
    buyerMessage: string,
    sellerMessage: string,
  ): Promise<void> {
    const label =
      STATUS_LABELS[OrderStatus.REJECTED_AT_HUB] ?? 'رد شده در هاب';
    const titleBase = `وضعیت سفارش: ${label}`;
    await this.dispatchOrderStatusPair({
      buyerId,
      sellerId,
      orderId,
      status: OrderStatus.REJECTED_AT_HUB,
      title: titleBase,
      buyerMessage,
      sellerMessage,
      metaExtras: {
        phase: 'hub_inspection_rejected',
        phaseKey: 'hub_inspection_rejected',
      },
    });
  }

  async notifyParties(
    buyerId: string,
    sellerId: string,
    orderId: string,
    status: OrderStatus,
    note?: string,
    options?: AdminOrderNotifyOptions,
  ): Promise<void> {
    const label =
      options?.statusLabel?.trim() ||
      STATUS_LABELS[status] ||
      status;
    const title = options?.title?.trim() || 'وضعیت سفارش تغییر کرد';
    const message =
      options?.message?.trim() ||
      (note
        ? `وضعیت سفارش به «${label}» تغییر یافت. توضیح: ${note}`
        : `وضعیت سفارش به «${label}» تغییر یافت.`);
    await this.dispatchOrderStatusPair({
      buyerId,
      sellerId,
      orderId,
      status,
      title,
      buyerMessage: message,
      sellerMessage: message,
      note,
      metaExtras: options?.metaExtras,
      statusLabel: options?.statusLabel,
    });
  }

  private async dispatchOrderStatusPair(params: {
    buyerId: string;
    sellerId: string;
    orderId: string;
    status: OrderStatus;
    title: string;
    buyerMessage: string;
    sellerMessage: string;
    note?: string;
    statusLabel?: string;
    metaExtras?: Record<string, unknown>;
  }): Promise<void> {
    const statusLabel =
      params.statusLabel?.trim() ||
      (params.metaExtras?.resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP'
        ? ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA
        : undefined);
    const statusPhaseKey =
      typeof params.status === 'string' && params.status.trim()
        ? params.status.trim().toUpperCase()
        : undefined;
    const metaBase = {
      orderId: params.orderId,
      status: params.status,
      note: params.note,
      ...(params.metaExtras ?? {}),
      ...(statusLabel
        ? {
            statusLabel,
            statusFa: statusLabel,
            orderStatusLabel: statusLabel,
          }
        : {}),
      ...(!params.metaExtras?.phaseKey &&
      !params.metaExtras?.phase &&
      statusPhaseKey
        ? { phase: statusPhaseKey, phaseKey: statusPhaseKey }
        : {}),
    };
    await Promise.all([
      this.notifications.create({
        userId: params.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: params.title,
        message: params.buyerMessage,
        forceSiteNotification: true,
        recipientRole: 'BUYER',
        meta: { ...metaBase, audience: 'BUYER', role: 'BUYER' },
      }),
      this.notifications.create({
        userId: params.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: params.title,
        message: params.sellerMessage,
        forceSiteNotification: true,
        recipientRole: 'SELLER',
        meta: { ...metaBase, audience: 'SELLER', role: 'SELLER' },
      }),
    ]);
  }
}
