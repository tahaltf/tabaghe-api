import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  ListingType,
  SecondChanceOfferStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { effectiveTrustScoreFromRating } from '../../../common/user-reputation.util';

import { WalletService } from '../../wallet/wallet.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { AuctionGateway } from '../auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from '../auction.events';
import { AuctionSupportService } from './auction-support.service';
import { MIN_TRUST_SCORE_FOR_AUCTION, DEFAULT_MAX_BIDS_PER_MINUTE, DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER, DEFAULT_MAX_REBIDS_PER_10_MIN, DEFAULT_MAX_BID_JUMP_MULTIPLIER } from '../auction.constants';


@Injectable()
export class AuctionBiddingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly support: AuctionSupportService,
  ) {}

  async placeBid(userId: string, listingId: string, amount: number) {
    const bidAmount = new Decimal(amount);

    if (bidAmount.lte(0)) {
      throw new BadRequestException('مبلغ پیشنهادی نامعتبر است');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT "listingId" FROM "ListingAuction" WHERE "listingId" = ${listingId} FOR UPDATE
      `;

      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: { select: { authorId: true } } },
      });
      const bidder = await tx.user.findUnique({
        where: { id: userId },
        select: { rating: true, isVerified: true },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (!bidder) throw new NotFoundException('کاربر یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new ForbiddenException('مزایده فعال نیست');
      }
      const minTrustScore = await this.support.getPolicyNumber(
        tx,
        'minTrustScore',
        'AUCTION_MIN_TRUST_SCORE',
        MIN_TRUST_SCORE_FOR_AUCTION,
        listingId,
        new Decimal(auction.basePrice),
      );
      if (
        !bidder.isVerified ||
        Number(effectiveTrustScoreFromRating(bidder.rating)) < minTrustScore
      ) {
        throw new ForbiddenException(
          'به دلیل وضعیت اعتماد حساب، امکان شرکت در مزایده برای شما فعال نیست. لطفاً با پشتیبانی تماس بگیرید.',
        );
      }
      if (new Date() >= auction.endDatetime) {
        throw new ForbiddenException('زمان مزایده تمام شده است');
      }
      if (auction.listing.authorId === userId) {
        throw new ForbiddenException('ثبت پیشنهاد روی آگهی خودتان مجاز نیست');
      }

      const oneMinuteAgo = new Date(Date.now() - 60_000);
      const maxBidsPerMinute = await this.support.getPolicyNumber(
        tx,
        'maxBidsPerMinute',
        'AUCTION_MAX_BIDS_PER_MINUTE',
        DEFAULT_MAX_BIDS_PER_MINUTE,
        listingId,
        new Decimal(auction.basePrice),
      );
      const recentBidsCount = await tx.auctionBid.count({
        where: { bidderId: userId, createdAt: { gte: oneMinuteAgo } },
      });
      if (recentBidsCount >= maxBidsPerMinute) {
        throw new ForbiddenException(
          'تعداد ثبت پیشنهاد شما در این دقیقه بیش از حد مجاز است',
        );
      }

      const maxActiveAuctions = await this.support.getPolicyNumber(
        tx,
        'maxActiveAuctionsPerUser',
        'AUCTION_MAX_ACTIVE_AUCTIONS_PER_USER',
        DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER,
        listingId,
        new Decimal(auction.basePrice),
      );
      const activeAuctionParticipations = await tx.auctionBid.count({
        where: {
          bidderId: userId,
          status: AuctionBidStatus.ACTIVE,
          auction: { status: AuctionStatus.ACTIVE },
        },
      });
      if (activeAuctionParticipations >= maxActiveAuctions) {
        throw new ForbiddenException(
          'تعداد مزایده‌های فعال شما به سقف مجاز رسیده است',
        );
      }

      const currentHighest = auction.highestBidAmount
        ? new Decimal(auction.highestBidAmount)
        : null;

      const minIncrement = new Decimal(auction.minBidIncrement);

      const minRequired = currentHighest
        ? currentHighest.plus(minIncrement)
        : new Decimal(auction.basePrice);

      if (bidAmount.lt(minRequired)) {
        throw new BadRequestException(
          `مبلغ پیشنهادی باید حداقل ${minRequired.toNumber().toLocaleString()} تومان باشد`,
        );
      }

      if (auction.highestBidderId === userId) {
        throw new BadRequestException(
          'شما در حال حاضر بالاترین پیشنهاد را دارید',
        );
      }

      // Anti-fraud v2 (behavioral guard): excessive re-bidding churn in short window
      const maxRebidsPer10Min = await this.support.getPolicyNumber(
        tx,
        'maxRebidsPer10Minutes',
        'AUCTION_MAX_REBIDS_PER_10_MINUTES',
        DEFAULT_MAX_REBIDS_PER_10_MIN,
        listingId,
        new Decimal(auction.basePrice),
      );
      const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
      const rebidsCount = await tx.auctionBid.count({
        where: {
          listingId,
          bidderId: userId,
          createdAt: { gte: tenMinutesAgo },
        },
      });
      if (rebidsCount >= maxRebidsPer10Min) {
        throw new ForbiddenException(
          'به دلیل رفتار غیرعادی در ثبت پیشنهاد، موقتاً امکان ادامه مزایده محدود شد',
        );
      }

      // Anti-fraud v2 (sanity guard): abnormal jump beyond configured multiplier
      if (currentHighest) {
        const maxJumpMultiplier = await this.support.getPolicyNumber(
          tx,
          'maxBidJumpMultiplier',
          'AUCTION_MAX_BID_JUMP_MULTIPLIER',
          DEFAULT_MAX_BID_JUMP_MULTIPLIER,
          listingId,
          new Decimal(auction.basePrice),
        );
        const maxAllowed = currentHighest.mul(maxJumpMultiplier);
        if (bidAmount.gt(maxAllowed)) {
          throw new BadRequestException(
            'افزایش قیمت پیشنهادی بیش از حد مجاز این مزایده است',
          );
        }
      }

      // ودیعه باید ثابت و مبتنی بر قیمت پایه مزایده باشد (نه مبلغ هر پیشنهاد).
      const depositAmount = await this.support.getFixedDepositAmount(tx, listingId);

      if (depositAmount.lte(0)) {
        throw new BadRequestException('خطا در محاسبه ودیعه (مبلغ نامعتبر)');
      }

      const myCurrentActiveBid = await tx.auctionBid.findFirst({
        where: { listingId, bidderId: userId, status: AuctionBidStatus.ACTIVE },
        orderBy: { amount: 'desc' },
      });
      const alreadyBlocked = new Decimal(
        myCurrentActiveBid?.blockedAmount ?? 0,
      );
      const diff = depositAmount.minus(alreadyBlocked);
      if (diff.gt(0)) {
        await this.walletService.blockAmount(userId, diff, listingId, tx);
      } else if (diff.lt(0)) {
        await this.walletService.unblockAmount(
          userId,
          diff.abs(),
          listingId,
          tx,
        );
      }
      if (myCurrentActiveBid) {
        await tx.auctionBid.update({
          where: { id: myCurrentActiveBid.id },
          data: { status: AuctionBidStatus.OUTBID, blockedAmount: 0 },
        });
      }

      const newBid = await tx.auctionBid.create({
        data: {
          listingId,
          bidderId: userId,
          amount: bidAmount,
          blockedAmount: depositAmount,
          status: AuctionBidStatus.ACTIVE,
        },
      });

      const { topBids, activeBids } = await this.support.getTopActiveBids(
        tx,
        listingId,
      );
      const topIds = new Set(topBids.map((b: any) => b.id));
      for (const bid of activeBids) {
        if (topIds.has(bid.id)) continue;
        const blocked = new Decimal(bid.blockedAmount ?? 0);
        if (blocked.gt(0)) {
          await this.walletService.unblockAmount(
            bid.bidderId,
            blocked,
            listingId,
            tx,
          );
        }
        await tx.auctionBid.update({
          where: { id: bid.id },
          data: { status: AuctionBidStatus.OUTBID, blockedAmount: 0 },
        });
      }

      const now = new Date();
      const extensionMinutes = await this.support.getLastMinuteExtensionMinutes(tx);
      const remaining = auction.endDatetime.getTime() - now.getTime();
      const shouldExtend =
        remaining > 0 && remaining <= extensionMinutes * 60_000;
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          highestBidAmount: topBids[0]?.amount ?? bidAmount,
          highestBidderId: topBids[0]?.bidderId ?? userId,
          secondBidderId: topBids[1]?.bidderId ?? null,
          thirdBidderId: topBids[2]?.bidderId ?? null,
          ...(shouldExtend
            ? {
                endDatetime: new Date(
                  auction.endDatetime.getTime() +
                    extensionMinutes * 60_000,
                ),
              }
            : {}),
        },
      });

      return newBid;
    });

    this.support.appendAuctionLedgerEvent({
      event: 'BID_PLACED',
      listingId,
      actorUserId: userId,
      amount: bidAmount.toNumber(),
    });
    this.support.appendAuctionTimelineEvent({
      event: 'BID_PLACED',
      listingId,
      actorUserId: userId,
      amount: bidAmount.toNumber(),
    });

    this.auctionGateway.emitBidPlaced(listingId, {
      bidderId: userId,
      amount: result.amount,
    });

    this.eventEmitter.emit(AuctionEvents.BID_PLACED, {
      listingId,
      bidderId: userId,
      amount: bidAmount.toString(),
    });

    return { ok: true, bid: result };
  }

  async cancelBid(userId: string, listingId: string) {
    void userId;
    void listingId;
    throw new ForbiddenException(
      'انصراف خودکار از مزایده غیرفعال است. در صورت خطای انسانی، از طریق پشتیبانی ثبت تیکت کنید.',
    );
  }

  // -----------------------------------
  // Buy now
  // canonical flow: فقط مزایده را تمام می‌کند و برنده را تعیین می‌کند.
  // پرداخت نهایی باید از مسیر checkout/order انجام شود.
  // -----------------------------------
  async buyNow(userId: string, listingId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: true },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE)
        throw new ForbiddenException('مزایده فعال نیست');
      if (!auction.buyNowEnabled || !auction.buyNowPrice)
        throw new BadRequestException('خرید فوری برای این مزایده فعال نیست');
      if (auction.listing.authorId === userId) {
        throw new ForbiddenException('ثبت خرید فوری روی آگهی خودتان مجاز نیست');
      }

      const amount = new Decimal(auction.buyNowPrice);
      const deadlineHours = await this.support.getWinnerPaymentDeadlineHours(tx);

      const bidders = [
        auction.highestBidderId,
        auction.secondBidderId,
        auction.thirdBidderId,
      ].filter((id) => id);

      for (const bId of bidders) {
        const bBid = await tx.auctionBid.findFirst({
          where: { listingId, bidderId: bId!, status: AuctionBidStatus.ACTIVE },
        });
        if (bBid) {
          await this.walletService.unblockAmount(
            bId!,
            bBid.blockedAmount,
            listingId,
            tx,
          );
        }
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          paymentDeadline: new Date(
            Date.now() + deadlineHours * 60 * 60 * 1000,
          ),
          finishedAt: new Date(),
          highestBidderId: userId,
          highestBidAmount: amount,
        },
      });

      // checkout/order به رکورد ACTIVE bid وابسته است
      await tx.auctionBid.updateMany({
        where: { listingId, bidderId: userId },
        data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
      });
      await tx.auctionBid.create({
        data: {
          listingId,
          bidderId: userId,
          amount,
          blockedAmount: 0,
          status: AuctionBidStatus.ACTIVE,
        },
      });

      return { buyerId: userId, amount };
    });

    this.auctionGateway.emitAuctionFinished(listingId, {
      type: 'BUY_NOW',
      winnerUserId: result.buyerId,
      amount: result.amount,
    });
    this.eventEmitter.emit(AuctionEvents.FINISHED, {
      listingId,
      winnerUserId: result.buyerId,
      amount: result.amount.toString(),
    });
    return { ok: true, ...result };
  }
}
