import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { AuctionEvents } from '../auction/auction.events';
import { ExchangeEvents } from '../exchange/exchange.events';
import { PurchaseOfferEvents } from '../purchase-offer/purchase-offer.events';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationListener {
  constructor(private readonly notificationService: NotificationService) {}

  // -----------------------------------
  // User got outbid → treated as LOST
  // -----------------------------------
  @OnEvent(AuctionEvents.OUTBID)
  async onOutbid(payload: { listingId: string; userId: string }) {
    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.AUCTION_LOST,
      title: 'پیشنهاد شما بالاتر زده شد',
      message: 'برای تکمیل معامله، پیشنهاد بالاتر ثبت کنید.',
      meta: {
        ...payload,
        phase: 'outbid',
        phaseKey: 'outbid',
      },
    });
  }

  // -----------------------------------
  // Auction finished – winner notified
  // -----------------------------------
  @OnEvent(AuctionEvents.FINISHED)
  async onAuctionFinished(payload: {
    winnerUserId: string;
    listingId: string;
  }) {
    await this.notificationService.create({
      userId: payload.winnerUserId,
      type: NotificationType.AUCTION_WON,
      title: 'مزایده را بردید — معامله را تکمیل کنید',
      message: 'پرداخت میانجی را قبل از پایان مهلت انجام دهید.',
      meta: {
        ...payload,
        phase: 'auction_won',
        phaseKey: 'auction_won',
      },
    });
  }

  // -----------------------------------
  // Winner penalized
  // -----------------------------------
  @OnEvent(AuctionEvents.PENALIZED)
  async onPenalty(payload: { userId: string; listingId: string }) {
    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.AUCTION_PENALIZED,
      title: 'جریمه شدید',
      message: 'به دلیل عدم پرداخت، جریمه اعمال شد.',
      meta: {
        ...payload,
        phase: 'penalized',
        phaseKey: 'penalized',
      },
    });
  }

  @OnEvent(AuctionEvents.SECOND_CHANCE_OFFERED)
  async onSecondChanceOffered(payload: { userId: string; listingId: string }) {
    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.AUCTION_PAYMENT_REMINDER,
      title: 'فرصت خرید نفر بعدی فعال شد',
      message: 'برنده قبلی پرداخت نکرد. در صورت تمایل پرداخت را تکمیل کنید.',
      meta: {
        ...payload,
        phase: 'second_chance',
        phaseKey: 'second_chance',
      },
    });
  }

  // -----------------------------------
  // Exchange offer created -> notify listing owner
  // -----------------------------------
  @OnEvent(ExchangeEvents.OFFER_CREATED)
  async onExchangeOfferCreated(payload: {
    listingId: string;
    ownerId: string;
    offererId: string;
    offerId: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.ownerId,
      type: NotificationType.EXCHANGE_OFFER_RECEIVED,
      title: 'پیشنهاد معاوضه جدید',
      message: 'برای آگهی شما یک درخواست معاوضه جدید ثبت شد.',
      recipientRole: 'OWNER',
      meta: {
        ...payload,
        role: 'OWNER',
        audience: 'OWNER',
        phase: 'exchange_offer_received',
        phaseKey: 'exchange_offer_received',
      },
    });
  }

  // -----------------------------------
  // Exchange offer accepted -> notify offerer
  // -----------------------------------
  @OnEvent(ExchangeEvents.OFFER_ACCEPTED)
  async onExchangeOfferAccepted(payload: {
    listingId: string;
    offererId: string;
    offerId: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.offererId,
      type: NotificationType.EXCHANGE_OFFER_ACCEPTED,
      title: 'پیشنهاد معاوضه شما تایید شد',
      message: 'پیشنهاد معاوضه شما توسط فروشنده تایید شد.',
      recipientRole: 'OFFERER',
      meta: {
        ...payload,
        role: 'OFFERER',
        audience: 'OFFERER',
        phase: 'exchange_offer_accepted',
        phaseKey: 'exchange_offer_accepted',
      },
    });
  }

  // -----------------------------------
  // Exchange offer rejected -> notify offerer
  // -----------------------------------
  @OnEvent(ExchangeEvents.OFFER_REJECTED)
  async onExchangeOfferRejected(payload: {
    listingId: string;
    offererId: string;
    offerId: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.offererId,
      type: NotificationType.EXCHANGE_OFFER_REJECTED,
      title: 'پیشنهاد معاوضه شما رد شد',
      message: 'پیشنهاد معاوضه شما توسط فروشنده رد شد.',
      recipientRole: 'OFFERER',
      meta: {
        ...payload,
        role: 'OFFERER',
        audience: 'OFFERER',
        phase: 'exchange_offer_rejected',
        phaseKey: 'exchange_offer_rejected',
      },
    });
  }

  @OnEvent(PurchaseOfferEvents.OFFER_CREATED)
  async onPurchaseOfferCreated(payload: {
    listingId: string;
    ownerId: string;
    buyerId: string;
    offerId: string;
    amount?: number;
    listingTitle?: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.ownerId,
      type: NotificationType.PURCHASE_OFFER_RECEIVED,
      title: 'پیشنهاد خرید جدید',
      message: 'برای آگهی شما یک پیشنهاد خرید جدید ثبت شد.',
      recipientRole: 'OWNER',
      meta: {
        ...payload,
        role: 'OWNER',
        audience: 'OWNER',
        phase: 'purchase_offer_received',
        phaseKey: 'purchase_offer_received',
      },
    });
  }

  @OnEvent(PurchaseOfferEvents.OFFER_ACCEPTED)
  async onPurchaseOfferAccepted(payload: {
    listingId: string;
    buyerId: string;
    offerId: string;
    amount?: number;
    amountFormatted?: string;
    listingTitle?: string;
    listingUrl?: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.buyerId,
      type: NotificationType.PURCHASE_OFFER_ACCEPTED,
      title: 'پیشنهاد خرید شما تایید شد',
        message:
        'فروشنده با پیشنهاد شما موافقت کرد. کالا در سبد خریدتان رزرو شده است؛ هرچه سریع‌تر خرید را تکمیل کنید.',
      recipientRole: 'BUYER',
      meta: {
        ...payload,
        role: 'BUYER',
        audience: 'BUYER',
        phase: 'purchase_offer_accepted',
        phaseKey: 'purchase_offer_accepted',
        listingUrl:
          payload.listingUrl ||
          (payload.listingId ? `/listing/${payload.listingId}` : undefined),
      },
    });
  }

  @OnEvent(PurchaseOfferEvents.OFFER_REJECTED)
  async onPurchaseOfferRejected(payload: {
    listingId: string;
    buyerId: string;
    offerId: string;
    reason?: string;
    listingTitle?: string;
  }) {
    await this.notificationService.createUserOperational({
      userId: payload.buyerId,
      type: NotificationType.PURCHASE_OFFER_REJECTED,
      title: 'پیشنهاد خرید شما رد شد',
      message: payload.reason
        ? `فروشنده پیشنهاد شما را رد کرد: ${payload.reason}`
        : 'فروشنده پیشنهاد خرید شما را رد کرد.',
      recipientRole: 'BUYER',
      meta: {
        ...payload,
        role: 'BUYER',
        audience: 'BUYER',
        phase: 'purchase_offer_rejected',
        phaseKey: 'purchase_offer_rejected',
      },
    });
  }
}
