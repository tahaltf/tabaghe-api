import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { AuctionEvents } from '../auction/auction.events';
import { ExchangeEvents } from '../exchange/exchange.events';
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
      message: 'کاربر دیگری پیشنهاد بالاتری ثبت کرده است.',
      meta: payload,
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
      title: 'شما برنده مزایده شدید',
      message: 'لطفاً پرداخت را قبل از پایان مهلت انجام دهید.',
      meta: payload,
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
      meta: payload,
    });
  }

  @OnEvent(AuctionEvents.SECOND_CHANCE_OFFERED)
  async onSecondChanceOffered(payload: { userId: string; listingId: string }) {
    await this.notificationService.create({
      userId: payload.userId,
      type: NotificationType.AUCTION_PAYMENT_REMINDER,
      title: 'فرصت خرید نفر بعدی فعال شد',
      message: 'برنده قبلی پرداخت نکرد. در صورت تمایل پرداخت را تکمیل کنید.',
      meta: payload,
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
    await this.notificationService.create({
      userId: payload.ownerId,
      type: NotificationType.EXCHANGE_OFFER_RECEIVED,
      title: 'پیشنهاد معاوضه جدید',
      message: 'برای آگهی شما یک درخواست معاوضه جدید ثبت شد.',
      meta: { ...payload, role: 'OWNER' },
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
    await this.notificationService.create({
      userId: payload.offererId,
      type: NotificationType.EXCHANGE_OFFER_ACCEPTED,
      title: 'پیشنهاد معاوضه شما تایید شد',
      message: 'پیشنهاد معاوضه شما توسط فروشنده تایید شد.',
      meta: { ...payload, role: 'OFFERER' },
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
    await this.notificationService.create({
      userId: payload.offererId,
      type: NotificationType.EXCHANGE_OFFER_REJECTED,
      title: 'پیشنهاد معاوضه شما رد شد',
      message: 'پیشنهاد معاوضه شما توسط فروشنده رد شد.',
      meta: { ...payload, role: 'OFFERER' },
    });
  }
}
