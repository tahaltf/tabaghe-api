import { Injectable } from '@nestjs/common';
import { NotificationType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';

type ExchangeOrderParties = {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
};

@Injectable()
export class ExchangeOrderNotifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async notifyReadyToShip(order: ExchangeOrderParties): Promise<void> {
    const listingTitle = await this.resolveListingTitle(order.listingId);
    const message = `پرداخت هر دو طرف برای معاوضه «${listingTitle}» تکمیل شد. لطفاً تا پایان مهلت، کالای خود را به انبار طبقه ارسال و کد رهگیری را در صفحه سفارش ثبت کنید.`;

    await Promise.all([
      this.notificationService.create({
        userId: order.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'زمان ارسال معاوضه',
        message,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
          phase: 'exchange_ready_to_ship',
          role: 'BUYER',
        },
      }),
      this.notificationService.create({
        userId: order.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'زمان ارسال معاوضه',
        message,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
          phase: 'exchange_ready_to_ship',
          role: 'SELLER',
        },
      }),
    ]);
  }

  async notifyParticipantPaid(
    order: ExchangeOrderParties,
    payerUserId: string,
  ): Promise<void> {
    const listingTitle = await this.resolveListingTitle(order.listingId);
    const peerUserId =
      payerUserId === order.buyerId ? order.sellerId : order.buyerId;
    const message = `طرف مقابل سهم خود را برای معاوضه «${listingTitle}» پرداخت کرد. پس از پرداخت شما، مرحله ارسال باز می‌شود.`;

    await this.notificationService.create({
      userId: peerUserId,
      type: NotificationType.ORDER_STATUS_CHANGED,
      title: 'پرداخت طرف مقابل معاوضه',
      message,
      meta: {
        orderId: order.id,
        listingId: order.listingId,
        status: OrderStatus.AWAITING_PAYMENT,
        phase: 'exchange_peer_paid',
        payerUserId,
      },
    });
  }

  async afterShipmentUpdated(
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
    const listingTitle = await this.resolveListingTitle(order.listingId);
    const sellerSent = Boolean(order.trackingCode);
    const buyerSent = Boolean(order.sellerTrackingCode);
    const peerUserId =
      shipperUserId === order.buyerId ? order.sellerId : order.buyerId;

    if (sellerSent && buyerSent) {
      const message = `هر دو طرف ارسال معاوضه «${listingTitle}» را ثبت کردند. پس از دریافت کالاها در انبار، کارشناسی آغاز می‌شود.`;
      await Promise.all([
        this.notificationService.create({
          userId: order.buyerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ثبت ارسال هر دو طرف',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            status: order.status,
            phase: 'exchange_both_shipped',
            role: 'BUYER',
          },
        }),
        this.notificationService.create({
          userId: order.sellerId,
          type: NotificationType.ORDER_STATUS_CHANGED,
          title: 'ثبت ارسال هر دو طرف',
          message,
          meta: {
            orderId: order.id,
            listingId: order.listingId,
            status: order.status,
            phase: 'exchange_both_shipped',
            role: 'SELLER',
          },
        }),
      ]);
      return;
    }

    await Promise.all([
      this.notificationService.create({
        userId: shipperUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'ثبت ارسال شما',
        message: `ارسال شما برای معاوضه «${listingTitle}» ثبت شد. منتظر ارسال طرف مقابل هستیم.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          status: order.status,
          phase: 'exchange_self_shipped',
        },
      }),
      this.notificationService.create({
        userId: peerUserId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'طرف مقابل ارسال کرد — ارسال شما',
        message: `طرف مقابل برای معاوضه «${listingTitle}» ارسال را ثبت کرده است. لطفاً تا پایان مهلت، ارسال خود را ثبت کنید.`,
        meta: {
          orderId: order.id,
          listingId: order.listingId,
          status: order.status,
          phase: 'exchange_peer_must_ship',
          shipperUserId,
        },
      }),
    ]);
  }

  private async resolveListingTitle(listingId: string): Promise<string> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
    return listing?.title?.trim() || 'کالا';
  }
}
