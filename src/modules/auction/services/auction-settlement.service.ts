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

import { WalletService } from '../../wallet/wallet.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { AuctionGateway } from '../auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from '../auction.events';
import { AuctionSupportService } from './auction-support.service';
import { OrderReputationService } from '../../orders/order-reputation.service';
import { DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS } from '../auction.constants';


@Injectable()
export class AuctionSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService,
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
    private readonly support: AuctionSupportService,
    private readonly orderReputation: OrderReputationService,
  ) {}

  async finalizeAuction(listingId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status === AuctionStatus.FINISHED) return null;

      const topBids = await this.support.syncAuctionRanking(tx, listingId);
      if (!topBids[0]?.bidderId) {
        await tx.listingAuction.update({
          where: { listingId },
          data: {
            status: AuctionStatus.FINISHED,
            settlementStatus: AuctionSettlementStatus.FAILED,
            finishedAt: new Date(),
          },
        });
        return { winner: null };
      }

      const deadlineHours = await this.support.getWinnerPaymentDeadlineHours(tx);
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          paymentDeadline: new Date(
            Date.now() + deadlineHours * 60 * 60 * 1000,
          ),
          finishedAt: new Date(),
        },
      });

      // در پایان مزایده فقط ودیعه نفر اول نگه داشته می‌شود.
      // ودیعه نفرات بعدی باید فوری آزاد شود تا سرمایه کاربر بی‌دلیل حبس نشود.
      const nonWinnerActiveBids = await tx.auctionBid.findMany({
        where: {
          listingId,
          status: AuctionBidStatus.ACTIVE,
          bidderId: { not: topBids[0].bidderId },
        },
      });
      for (const bid of nonWinnerActiveBids) {
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

      return {
        winnerUserId: topBids[0].bidderId,
        amount: topBids[0].amount,
      };
    });

    if (result?.winnerUserId) {
      this.support.appendAuctionTimelineEvent({
        event: 'AUCTION_FINISHED',
        listingId,
        winnerUserId: result.winnerUserId,
        amount: Number(result.amount),
      });
      this.auctionGateway.emitAuctionFinished(listingId, result);
      this.eventEmitter.emit(AuctionEvents.FINISHED, {
        listingId,
        winnerUserId: result.winnerUserId,
        amount: result.amount.toString(),
      });
    }

    return result;
  }

  // -----------------------------------
  // Pay auction (با کسر کارمزد داینامیک)
  // -----------------------------------
  async payAuction(userId: string | null, listingId: string) {
    const res = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: true },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');

      if (userId && auction.highestBidderId !== userId) {
        throw new ForbiddenException('شما برنده فعلی مزایده نیستید');
      }
      if (auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
        throw new BadRequestException('مزایده قبلا تسویه شده یا منقضی شده است');
      }

      const payerId = userId || auction.highestBidderId;

      if (!payerId) {
        throw new BadRequestException('برنده‌ای برای پرداخت وجود ندارد');
      }

      const winnerBid = await tx.auctionBid.findFirst({
        where: {
          listingId,
          bidderId: payerId,
          status: AuctionBidStatus.ACTIVE,
        },
        orderBy: { amount: 'desc' },
      });
      if (!winnerBid) {
        throw new BadRequestException('پیشنهاد فعال برنده برای تسویه یافت نشد');
      }

      const totalAmount = new Decimal(auction.highestBidAmount!);
      const blockedDeposit = new Decimal(winnerBid.blockedAmount || 0);

      // 👈 محاسبه کارمزد پلتفرم برای مزایده
      const platformFee = await this.feeCalculator.calculateFee(
        ListingType.AUCTION,
        auction.listing.categoryId,
        totalAmount,
        { sellerId: auction.listing.authorId },
      );

      await this.walletService.payAuctionFinal(
        payerId,
        auction.listing.authorId,
        totalAmount,
        blockedDeposit,
        platformFee, // 👈 جایگزین 0 شد
        listingId,
        tx,
      );

      const activeOtherBids = await tx.auctionBid.findMany({
        where: {
          listingId,
          status: AuctionBidStatus.ACTIVE,
          bidderId: { not: payerId },
        },
      });
      for (const otherBid of activeOtherBids) {
        const blocked = new Decimal(otherBid.blockedAmount ?? 0);
        if (blocked.gt(0)) {
          await this.walletService.unblockAmount(
            otherBid.bidderId,
            blocked,
            listingId,
            tx,
          );
        }
        await tx.auctionBid.update({
          where: { id: otherBid.id },
          data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
        });
      }

      await tx.listingAuction.update({
        where: { listingId },
        data: {
          settlementStatus: AuctionSettlementStatus.PAID,
        },
      });

      await tx.auctionBid.update({
        where: { id: winnerBid.id },
        data: { status: AuctionBidStatus.WON, blockedAmount: 0 },
      });

      return { ok: true, message: 'پرداخت با موفقیت انجام شد' };
    });
    this.support.appendAuctionLedgerEvent({
      event: 'AUCTION_PAID',
      listingId,
      actorUserId: userId,
    });
    return res;
  }

  // -----------------------------------
  // CRON & PROCESS LOGIC
  // -----------------------------------

  async checkUnpaidAuctions() {
    const now = new Date();
    const secondChancePaymentHours =
      await this.support.getSecondChancePaymentDeadlineHours();
    const expiredAuctions = await this.prisma.listingAuction.findMany({
      where: {
        status: AuctionStatus.FINISHED,
        settlementStatus: AuctionSettlementStatus.PENDING,
        paymentDeadline: { lt: now },
      },
    });

    for (const auction of expiredAuctions) {
      const finishTimestamp = auction.finishedAt
        ? new Date(auction.finishedAt).getTime()
        : 0;
      const deadlineTimestamp = auction.paymentDeadline
        ? new Date(auction.paymentDeadline).getTime()
        : 0;
      const deadlineHours =
        deadlineTimestamp > finishTimestamp
          ? (deadlineTimestamp - finishTimestamp) / (60 * 60 * 1000)
          : DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS;
      const isSecondChanceRound = deadlineHours <= secondChancePaymentHours + 1;
      await this.processNextWinner(
        auction.listingId,
        isSecondChanceRound
          ? { mode: 'second_chance_timeout' }
          : { mode: 'penalize' },
      );
    }
  }

  async penalizeWinner(listingId: string) {
    return this.processNextWinner(listingId, { mode: 'penalize' });
  }

  async declineSecondChance(userId: string, listingId: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      select: {
        status: true,
        settlementStatus: true,
        highestBidderId: true,
      },
    });
    if (!auction) throw new NotFoundException('مزایده یافت نشد');
    if (auction.status !== AuctionStatus.FINISHED) {
      throw new BadRequestException('این مزایده هنوز نهایی نشده است');
    }
    if (auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
      throw new BadRequestException('این مزایده در وضعیت قابل پاسخ‌گویی نیست');
    }
    if (auction.highestBidderId !== userId) {
      throw new ForbiddenException(
        'فقط برنده فعلی می‌تواند پیشنهاد شانس دوم را رد کند',
      );
    }

    return this.processNextWinner(listingId, {
      mode: 'decline',
      actingUserId: userId,
    });
  }

  private async processNextWinner(
    listingId: string,
    options:
      | { mode: 'penalize' }
      | { mode: 'decline'; actingUserId: string }
      | { mode: 'second_chance_timeout' } = { mode: 'penalize' },
  ) {
    await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });
      if (!auction) return;
      if (
        auction.status !== AuctionStatus.FINISHED ||
        auction.settlementStatus !== AuctionSettlementStatus.PENDING
      ) {
        return;
      }

      const isPenalize = options.mode === 'penalize';
      const isDecline = options.mode === 'decline';
      const isSecondChanceTimeout = options.mode === 'second_chance_timeout';
      const now = new Date();

      // Optimistic concurrency (compare-and-swap): if another worker changed auction row,
      // this transition is skipped to avoid double-processing.
      const cas = await tx.listingAuction.updateMany({
        where: {
          listingId,
          status: AuctionStatus.FINISHED,
          settlementStatus: AuctionSettlementStatus.PENDING,
          highestBidderId: auction.highestBidderId,
          highestBidAmount: auction.highestBidAmount,
          paymentDeadline: auction.paymentDeadline,
          finishedAt: auction.finishedAt,
        },
        data: {
          // no logical state change; this write only claims transition ownership
          settlementStatus: AuctionSettlementStatus.PENDING,
        },
      });
      if (!cas.count) return;

      // State-machine transition guard برای شانس دوم:
      // decline: OFFERED -> DECLINED (فقط توسط همان کاربر)
      // timeout: OFFERED -> EXPIRED (فقط در کران زمانی)
      if ((isDecline || isSecondChanceTimeout) && auction.highestBidderId) {
        const transitionUserId = isDecline
          ? options.actingUserId
          : auction.highestBidderId;
        const offerTransition = await tx.secondChanceOffer.updateMany({
          where: {
            listingId,
            userId: transitionUserId,
            status: SecondChanceOfferStatus.OFFERED,
            ...(isDecline
              ? { expiresAt: { gt: now } }
              : { expiresAt: { lte: now } }),
          },
          data: isDecline
            ? {
                status: SecondChanceOfferStatus.DECLINED,
                declinedAt: now,
              }
            : {
                status: SecondChanceOfferStatus.EXPIRED,
                expiredAt: now,
              },
        });
        // اگر transition انجام نشد یعنی قبلاً توسط مسیر دیگری پردازش شده؛
        // برای idempotency/race-safe بدون خطا خارج می‌شویم.
        if (!offerTransition.count) return;
      }

      const currentWinnerBid = auction.highestBidderId
        ? await tx.auctionBid.findFirst({
            where: {
              listingId,
              bidderId: auction.highestBidderId,
              status: AuctionBidStatus.ACTIVE,
            },
            orderBy: { amount: 'desc' },
          })
        : null;

      if (currentWinnerBid) {
        const blocked = new Decimal(currentWinnerBid.blockedAmount ?? 0);
        if (blocked.gt(0) && isPenalize) {
          await this.walletService.confiscateBlocked(
            currentWinnerBid.bidderId,
            blocked,
            listingId,
            tx,
          );
          await this.orderReputation.applyTrustPointsPenalty(
            tx,
            [currentWinnerBid.bidderId],
            5,
            {
              listingId,
              reason: 'جریمه عدم پرداخت مزایده',
              source: 'auction_no_pay',
            },
          );
          this.eventEmitter.emit(AuctionEvents.PENALIZED, {
            listingId,
            userId: currentWinnerBid.bidderId,
          });
        }
        await tx.auctionBid.update({
          where: { id: currentWinnerBid.id },
          data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
        });
      }

      const nextWinner = await tx.auctionBid.findFirst({
        where: {
          listingId,
          status: AuctionBidStatus.OUTBID,
        },
        orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
      });
      if (!nextWinner) {
        await tx.listingAuction.update({
          where: { listingId },
          data: {
            settlementStatus: AuctionSettlementStatus.FAILED,
            paymentDeadline: null,
          },
        });
        return;
      }

      await tx.auctionBid.update({
        where: { id: nextWinner.id },
        data: { status: AuctionBidStatus.ACTIVE },
      });

      const deadlineHours = await this.support.getSecondChancePaymentDeadlineHours(tx);
      const ranking = await this.support.syncAuctionRanking(tx, listingId);
      await tx.listingAuction.update({
        where: { listingId },
        data: {
          highestBidAmount: ranking[0]?.amount ?? nextWinner.amount,
          highestBidderId: ranking[0]?.bidderId ?? nextWinner.bidderId,
          secondBidderId: ranking[1]?.bidderId ?? null,
          thirdBidderId: ranking[2]?.bidderId ?? null,
          paymentDeadline: new Date(
            Date.now() + deadlineHours * 60 * 60 * 1000,
          ),
          settlementStatus: AuctionSettlementStatus.PENDING,
          finishedAt: new Date(),
        },
      });

      // ثبت رسمی پیشنهاد شانس دوم برای audit و کنترل وضعیت‌ها
      await tx.secondChanceOffer.create({
        data: {
          listingId,
          userId: nextWinner.bidderId,
          amount: nextWinner.amount,
          status: SecondChanceOfferStatus.OFFERED,
          expiresAt: new Date(now.getTime() + deadlineHours * 60 * 60 * 1000),
        },
      });

      this.eventEmitter.emit(AuctionEvents.SECOND_CHANCE_OFFERED, {
        listingId,
        userId: nextWinner.bidderId,
      });

      this.support.appendAuctionTimelineEvent({
        event: isPenalize
          ? 'SECOND_CHANCE_FROM_PENALTY'
          : isDecline
            ? 'SECOND_CHANCE_FROM_DECLINE'
            : 'SECOND_CHANCE_FROM_TIMEOUT',
        listingId,
        fromUserId:
          currentWinnerBid?.bidderId ?? auction.highestBidderId ?? null,
        toUserId: nextWinner.bidderId,
        amount: Number(nextWinner.amount),
      });
    });
  }

  async forcePenalizeWinner(listingId: string) {
    return this.penalizeWinner(listingId);
  }

  async forceRefundAuction(listingId: string) {
    return this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });
      if (!auction) throw new NotFoundException('مزایده یافت نشد');

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
        data: { settlementStatus: AuctionSettlementStatus.FAILED },
      });
      return { ok: true, message: 'مزایده لغو و مبالغ عودت داده شد' };
    });
  }

  async forceSettleAuction(listingId: string) {
    return this.payAuction(null, listingId);
  }
}
