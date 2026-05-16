import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AuctionSettlementStatus,
  AuctionStatus,
  ExchangeOfferStatus,
  NotificationType,
  OrderStatus,
  OrderType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';

type ReminderAction =
  | 'exchange_payment'
  | 'exchange_shipment'
  | 'order_seller_shipment'
  | 'auction_payment';

const AWAITING_SHIPMENT_STATUSES: OrderStatus[] = [
  OrderStatus.PAID,
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
];

@Injectable()
export class DeadlineReminderService {
  private readonly logger = new Logger(DeadlineReminderService.name);
  private static readonly DEFAULT_REMINDER_HOURS = 12;
  private static readonly DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES = 24 * 60;
  private static readonly DEFAULT_EXCHANGE_SHIP_DEADLINE_MINUTES = 48 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  @Cron('0 */15 * * * *')
  async runDeadlineReminders(): Promise<void> {
    try {
      const windowHours = await this.getReminderWindowHours();
      await this.processExchangePaymentReminders(windowHours);
      await this.processExchangeShipmentReminders(windowHours);
      await this.processSellerShipmentReminders(windowHours);
      await this.processAuctionPaymentReminders(windowHours);
    } catch (err) {
      this.logger.error(
        'Deadline reminder job failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  private async getReminderWindowHours(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'ACTION_DEADLINE_REMINDER_HOURS' },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? '');
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.min(168, Math.floor(parsed));
    }
    return DeadlineReminderService.DEFAULT_REMINDER_HOURS;
  }

  private async getExchangePaymentDeadlineMinutes(): Promise<number> {
    const minutesRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_PAYMENT_DEADLINE_MINUTES' },
    });
    if (minutesRow?.value?.trim()) {
      const parsed = Number(minutesRow.value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
    const hoursRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'EXCHANGE_NO_PAYMENT_TIMEOUT_HOURS' },
    });
    const hours = Number(hoursRow?.value ?? '');
    if (Number.isFinite(hours) && hours > 0) return Math.floor(hours * 60);
    return DeadlineReminderService.DEFAULT_EXCHANGE_PAYMENT_DEADLINE_MINUTES;
  }

  private isInReminderWindow(deadline: Date, windowHours: number): boolean {
    const now = Date.now();
    const end = deadline.getTime();
    const windowMs = windowHours * 60 * 60 * 1000;
    return end > now && end <= now + windowMs;
  }

  private formatDeadlineFa(deadline: Date): string {
    return deadline.toLocaleString('fa-IR', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'Asia/Tehran',
    });
  }

  private async hasReminderBeenSent(
    userId: string,
    action: ReminderAction,
    entityId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.notification.findFirst({
      where: {
        userId,
        type: NotificationType.ACTION_DEADLINE_REMINDER,
        meta: {
          path: ['reminderAction'],
          equals: action,
        },
        AND: {
          meta: {
            path: ['entityId'],
            equals: entityId,
          },
        },
      },
      select: { id: true },
    });
    return Boolean(existing);
  }

  private async sendDeadlineReminder(params: {
    userId: string;
    action: ReminderAction;
    entityId: string;
    listingId?: string;
    title: string;
    message: string;
    deadlineAt: Date;
    hoursLeft: number;
    actionLabel: string;
  }): Promise<void> {
    if (await this.hasReminderBeenSent(params.userId, params.action, params.entityId)) {
      return;
    }

    await this.notificationService.create({
      userId: params.userId,
      type: NotificationType.ACTION_DEADLINE_REMINDER,
      title: params.title,
      message: params.message,
      meta: {
        reminderAction: params.action,
        entityId: params.entityId,
        listingId: params.listingId,
        deadlineAt: params.deadlineAt.toISOString(),
        hoursLeft: params.hoursLeft,
        actionLabel: params.actionLabel,
        deadlineFa: this.formatDeadlineFa(params.deadlineAt),
      },
    });
  }

  private async processExchangePaymentReminders(
    windowHours: number,
  ): Promise<void> {
    const paymentDeadlineMinutes = await this.getExchangePaymentDeadlineMinutes();
    const feeRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'VERIFICATION_FEE' },
    });
    const defaultVerificationFee = Number(feeRow?.value || 250_000) || 250_000;

    const offers = await this.prisma.exchangeOffer.findMany({
      where: { status: ExchangeOfferStatus.ACCEPTED },
      include: {
        listing: { select: { id: true, title: true, authorId: true } },
      },
    });

    const now = Date.now();

    for (const offer of offers) {
      const deadline = new Date(
        new Date(offer.updatedAt).getTime() +
          paymentDeadlineMinutes * 60 * 1000,
      );
      if (!this.isInReminderWindow(deadline, windowHours)) continue;

      const order = await this.prisma.order.findFirst({
        where: { exchangeOfferId: offer.id },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          verificationFee: true,
          shippingAddress: true,
          sellerShippingAddress: true,
        },
      });

      if (
        order &&
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.PENDING
      ) {
        continue;
      }

      const verificationFee = Number(order?.verificationFee || defaultVerificationFee);
      const extra = Number(offer.extraPayment || 0);
      const buyerShare = verificationFee + (offer.isPayerMe ? extra : 0);
      const sellerShare = verificationFee + (!offer.isPayerMe ? extra : 0);
      const expectedTotal = buyerShare + sellerShare;
      const currentTotal = Number(order?.totalAmount || 0);

      const buyerPaid =
        !!order &&
        Boolean(order.shippingAddress) &&
        currentTotal >= buyerShare;
      const sellerPaid =
        !!order &&
        Boolean(order.sellerShippingAddress) &&
        currentTotal >= expectedTotal;

      const hoursLeft = Math.max(
        1,
        Math.ceil((deadline.getTime() - now) / (60 * 60 * 1000)),
      );
      const listingTitle = offer.listing?.title ?? 'معاوضه';
      const listingId = offer.listingId;
      const entityId = order?.id ?? offer.id;

      if (!buyerPaid) {
        await this.sendDeadlineReminder({
          userId: offer.offererId,
          action: 'exchange_payment',
          entityId: `${entityId}:buyer`,
          listingId,
          title: 'یادآوری: مهلت پرداخت معاوضه',
          message: `برای «${listingTitle}» کمتر از ${hoursLeft} ساعت تا پایان مهلت پرداخت سهم شما باقی مانده. لطفاً هرچه زودتر پرداخت را تکمیل کنید.`,
          deadlineAt: deadline,
          hoursLeft,
          actionLabel: 'پرداخت معاوضه',
        });
      }

      if (!sellerPaid && offer.listing?.authorId) {
        await this.sendDeadlineReminder({
          userId: offer.listing.authorId,
          action: 'exchange_payment',
          entityId: `${entityId}:seller`,
          listingId,
          title: 'یادآوری: مهلت پرداخت معاوضه',
          message: `برای «${listingTitle}» کمتر از ${hoursLeft} ساعت تا پایان مهلت پرداخت سهم شما باقی مانده. لطفاً هرچه زودتر پرداخت را تکمیل کنید.`,
          deadlineAt: deadline,
          hoursLeft,
          actionLabel: 'پرداخت معاوضه',
        });
      }
    }
  }

  private async processExchangeShipmentReminders(
    windowHours: number,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        type: OrderType.EXCHANGE,
        status: { in: AWAITING_SHIPMENT_STATUSES },
        shippingDeadline: { not: null },
      },
      include: {
        listing: { select: { id: true, title: true } },
      },
    });

    const now = Date.now();

    for (const order of orders) {
      const deadline = order.shippingDeadline!;
      if (!this.isInReminderWindow(deadline, windowHours)) continue;

      const hoursLeft = Math.max(
        1,
        Math.ceil((deadline.getTime() - now) / (60 * 60 * 1000)),
      );
      const listingTitle = order.listing?.title ?? 'معاوضه';

      if (!order.trackingCode) {
        await this.sendDeadlineReminder({
          userId: order.sellerId,
          action: 'exchange_shipment',
          entityId: `${order.id}:seller`,
          listingId: order.listingId,
          title: 'یادآوری: مهلت ارسال به هاب',
          message: `برای معاوضه «${listingTitle}» کمتر از ${hoursLeft} ساعت تا پایان مهلت ثبت ارسال کالای شما باقی مانده.`,
          deadlineAt: deadline,
          hoursLeft,
          actionLabel: 'ارسال به هاب',
        });
      }

      if (!order.sellerTrackingCode) {
        await this.sendDeadlineReminder({
          userId: order.buyerId,
          action: 'exchange_shipment',
          entityId: `${order.id}:buyer`,
          listingId: order.listingId,
          title: 'یادآوری: مهلت ارسال به هاب',
          message: `برای معاوضه «${listingTitle}» کمتر از ${hoursLeft} ساعت تا پایان مهلت ثبت ارسال کالای شما باقی مانده.`,
          deadlineAt: deadline,
          hoursLeft,
          actionLabel: 'ارسال به هاب',
        });
      }
    }
  }

  private async processSellerShipmentReminders(
    windowHours: number,
  ): Promise<void> {
    const orders = await this.prisma.order.findMany({
      where: {
        type: { in: [OrderType.DIRECT, OrderType.AUCTION] },
        status: { in: AWAITING_SHIPMENT_STATUSES },
        shippingDeadline: { not: null },
        trackingCode: null,
      },
      include: {
        listing: { select: { id: true, title: true } },
      },
    });

    const now = Date.now();

    for (const order of orders) {
      const deadline = order.shippingDeadline!;
      if (!this.isInReminderWindow(deadline, windowHours)) continue;

      const hoursLeft = Math.max(
        1,
        Math.ceil((deadline.getTime() - now) / (60 * 60 * 1000)),
      );
      const listingTitle = order.listing?.title ?? 'سفارش';

      await this.sendDeadlineReminder({
        userId: order.sellerId,
        action: 'order_seller_shipment',
        entityId: order.id,
        listingId: order.listingId,
        title: 'یادآوری: مهلت ارسال سفارش',
        message: `برای «${listingTitle}» کمتر از ${hoursLeft} ساعت تا پایان مهلت ثبت کد رهگیری و ارسال باقی مانده.`,
        deadlineAt: deadline,
        hoursLeft,
        actionLabel: 'ارسال کالا',
      });
    }
  }

  private async processAuctionPaymentReminders(
    windowHours: number,
  ): Promise<void> {
    const now = new Date();
    const windowEnd = new Date(now.getTime() + windowHours * 60 * 60 * 1000);

    const auctions = await this.prisma.listingAuction.findMany({
      where: {
        status: AuctionStatus.FINISHED,
        settlementStatus: AuctionSettlementStatus.PENDING,
        paymentDeadline: { gt: now, lte: windowEnd },
        highestBidderId: { not: null },
      },
      include: {
        listing: { select: { id: true, title: true } },
      },
    });

    for (const auction of auctions) {
      if (!auction.highestBidderId || !auction.paymentDeadline) continue;

      const hasCompletedPayment = await this.prisma.order.findFirst({
        where: {
          listingId: auction.listingId,
          buyerId: auction.highestBidderId,
          status: {
            notIn: [
              OrderStatus.CANCELLED,
              OrderStatus.PENDING,
              OrderStatus.AWAITING_PAYMENT,
            ],
          },
        },
        select: { id: true },
      });
      if (hasCompletedPayment) continue;

      const deadline = auction.paymentDeadline;
      const hoursLeft = Math.max(
        1,
        Math.ceil((deadline.getTime() - Date.now()) / (60 * 60 * 1000)),
      );
      const listingTitle = auction.listing?.title ?? 'مزایده';

      await this.sendDeadlineReminder({
        userId: auction.highestBidderId,
        action: 'auction_payment',
        entityId: auction.listingId,
        listingId: auction.listingId,
        title: 'یادآوری: مهلت پرداخت مزایده',
        message: `شما برنده «${listingTitle}» هستید. کمتر از ${hoursLeft} ساعت تا پایان مهلت پرداخت باقی مانده.`,
        deadlineAt: deadline,
        hoursLeft,
        actionLabel: 'پرداخت مزایده',
      });
    }
  }
}
