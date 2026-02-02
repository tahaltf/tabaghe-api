import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationService } from './notification.service';
import { AuctionEvents } from '../auction/auction.events';
import { NotificationType } from '@prisma/client';

@Injectable()
export class NotificationListener {
    constructor(
        private readonly notificationService: NotificationService,
    ) {}

    // -----------------------------------
    // User got outbid → treated as LOST
    // -----------------------------------
    @OnEvent(AuctionEvents.OUTBID)
    async onOutbid(payload: {
        listingId: string;
        userId: string;
    }) {
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
    async onPenalty(payload: {
        userId: string;
        listingId: string;
    }) {
        await this.notificationService.create({
            userId: payload.userId,
            type: NotificationType.AUCTION_PENALIZED,
            title: 'جریمه شدید',
            message: 'به دلیل عدم پرداخت، جریمه اعمال شد.',
            meta: payload,
        });
    }
}
