import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service'; // 👈 اضافه شد
import {
  AuctionBidStatus,
  AuctionStatus,
  AuctionSettlementStatus,
  ListingType, // 👈 اضافه شد
  SecondChanceOfferStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { AuctionGateway } from './auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from './auction.events';
import { appendJsonLog } from '../../common/logging/app-log.util';

const TOP_BIDDERS_LIMIT = 4;
const LAST_MINUTE_EXTENSION_MINUTES = 10;
const DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS = 48;
const DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS = 24;
const MIN_TRUST_SCORE_FOR_AUCTION = 40;
const DEFAULT_AUCTION_DEPOSIT_MIN = 50_000;
const DEFAULT_AUCTION_DEPOSIT_MAX = 500_000_000;
const DEFAULT_MAX_BIDS_PER_MINUTE = 20;
const DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER = 15;
const DEFAULT_MAX_REBIDS_PER_10_MIN = 8;
const DEFAULT_MAX_BID_JUMP_MULTIPLIER = 2.5;

@Injectable()
export class AuctionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly feeCalculator: FeeCalculatorService, // 👈 تزریق شد
    private readonly auctionGateway: AuctionGateway,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private appendAuctionLedgerEvent(payload: Record<string, unknown>) {
    appendJsonLog('auction-ledger.log', {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  private appendAuctionTimelineEvent(payload: Record<string, unknown>) {
    appendJsonLog('auction-timeline.log', {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  private async getWinnerPaymentDeadlineHours(tx: any): Promise<number> {
    const row = await tx.systemSetting.findUnique({
      where: { key: 'AUCTION_WINNER_PAYMENT_DEADLINE_HOURS' },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS;
    }
    return Math.floor(parsed);
  }

  private async getSecondChancePaymentDeadlineHours(tx?: any): Promise<number> {
    const client = tx ?? this.prisma;
    const row = await client.systemSetting.findUnique({
      where: { key: 'AUCTION_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS' },
      select: { value: true },
    });
    const parsed = Number(
      row?.value ?? DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS,
    );
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS;
    }
    return Math.floor(parsed);
  }

  private async getNumericSetting(
    tx: any,
    key: string,
    fallback: number,
  ): Promise<number> {
    const row = await tx.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const parsed = Number(row?.value ?? fallback);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return parsed;
  }

  private async getPolicyNumber(
    tx: any,
    policyKey: string,
    settingKey: string,
    fallback: number,
    listingId?: string,
    basePrice?: Decimal,
  ): Promise<number> {
    const policyRow = await tx.systemSetting.findUnique({
      where: { key: 'AUCTION_POLICY_V2_JSON' },
      select: { value: true },
    });
    let policy: any = null;
    try {
      policy = policyRow?.value ? JSON.parse(policyRow.value) : null;
    } catch {
      policy = null;
    }
    const categoryId = listingId
      ? (
          await tx.listing.findUnique({
            where: { id: listingId },
            select: { categoryId: true },
          })
        )?.categoryId
      : null;

    const fromGlobal = Number(policy?.global?.[policyKey]);
    const fromCategory = categoryId
      ? Number(policy?.categories?.[categoryId]?.[policyKey])
      : NaN;
    let fromTier = NaN;
    if (basePrice && Array.isArray(policy?.priceTiers)) {
      const price = basePrice.toNumber();
      const tier = policy.priceTiers.find((t: any) => {
        const min = Number(t?.min ?? 0);
        const max = t?.max == null ? Number.POSITIVE_INFINITY : Number(t.max);
        return Number.isFinite(min) && price >= min && price <= max;
      });
      fromTier = Number(tier?.values?.[policyKey]);
    }
    const hierarchical =
      Number.isFinite(fromTier) && fromTier > 0
        ? fromTier
        : Number.isFinite(fromCategory) && fromCategory > 0
          ? fromCategory
          : Number.isFinite(fromGlobal) && fromGlobal > 0
            ? fromGlobal
            : NaN;
    if (Number.isFinite(hierarchical) && hierarchical > 0) return hierarchical;
    return this.getNumericSetting(tx, settingKey, fallback);
  }

  private async getAuctionDepositPercent(
    tx: any,
    listingId: string,
  ): Promise<Decimal> {
    const listing = await tx.listing.findUnique({
      where: { id: listingId },
      select: {
        categoryId: true,
        category: { select: { auctionDepositPercent: true } },
      },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    const feeRule = await tx.feeRule.findFirst({
      where: {
        listingType: ListingType.AUCTION,
        isActive: true,
        categoryId: listing.categoryId,
      },
      orderBy: { createdAt: 'desc' },
      select: { auctionDepositPercent: true },
    });

    const percent =
      feeRule?.auctionDepositPercent ??
      listing.category?.auctionDepositPercent ??
      10;
    const dec = new Decimal(percent);
    return dec.gt(0) ? dec : new Decimal(10);
  }

  private async getFixedDepositAmount(
    tx: any,
    listingId: string,
  ): Promise<Decimal> {
    const auction = await tx.listingAuction.findUnique({
      where: { listingId },
      select: { basePrice: true },
    });
    if (!auction) throw new NotFoundException('مزایده یافت نشد');

    const depositPercent = await this.getAuctionDepositPercent(tx, listingId);
    const minDeposit = await this.getPolicyNumber(
      tx,
      'depositMin',
      'AUCTION_DEPOSIT_MIN',
      DEFAULT_AUCTION_DEPOSIT_MIN,
      listingId,
      new Decimal(auction.basePrice),
    );
    const maxDeposit = await this.getPolicyNumber(
      tx,
      'depositMax',
      'AUCTION_DEPOSIT_MAX',
      DEFAULT_AUCTION_DEPOSIT_MAX,
      listingId,
      new Decimal(auction.basePrice),
    );
    const raw = new Decimal(auction.basePrice)
      .mul(depositPercent)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_CEIL);
    const clamped = Decimal.max(
      new Decimal(minDeposit),
      Decimal.min(raw, new Decimal(maxDeposit)),
    );
    return clamped;
  }

  private async getTopActiveBids(tx: any, listingId: string) {
    const activeBids = await tx.auctionBid.findMany({
      where: { listingId, status: AuctionBidStatus.ACTIVE },
      orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
    });
    const topBids: any[] = [];
    const bidderSeen = new Set<string>();
    for (const bid of activeBids) {
      if (bidderSeen.has(bid.bidderId)) continue;
      topBids.push(bid);
      bidderSeen.add(bid.bidderId);
      if (topBids.length >= TOP_BIDDERS_LIMIT) break;
    }
    return { topBids, activeBids };
  }

  private async syncAuctionRanking(tx: any, listingId: string) {
    const { topBids } = await this.getTopActiveBids(tx, listingId);
    await tx.listingAuction.update({
      where: { listingId },
      data: {
        highestBidAmount: topBids[0]?.amount ?? null,
        highestBidderId: topBids[0]?.bidderId ?? null,
        secondBidderId: topBids[1]?.bidderId ?? null,
        thirdBidderId: topBids[2]?.bidderId ?? null,
      },
    });
    return topBids;
  }

  // -----------------------------------
  // Place bid (اصلاح شده با فرمت پول)
  // -----------------------------------
  async placeBid(userId: string, listingId: string, amount: number) {
    const bidAmount = new Decimal(amount);

    if (bidAmount.lte(0)) {
      throw new BadRequestException('مبلغ پیشنهادی نامعتبر است');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
        include: { listing: { select: { authorId: true } } },
      });
      const bidder = await tx.user.findUnique({
        where: { id: userId },
        select: { trustScore: true, isVerified: true },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (!bidder) throw new NotFoundException('کاربر یافت نشد');
      if (auction.status !== AuctionStatus.ACTIVE) {
        throw new ForbiddenException('مزایده فعال نیست');
      }
      const minTrustScore = await this.getPolicyNumber(
        tx,
        'minTrustScore',
        'AUCTION_MIN_TRUST_SCORE',
        MIN_TRUST_SCORE_FOR_AUCTION,
        listingId,
        new Decimal(auction.basePrice),
      );
      if (
        !bidder.isVerified ||
        Number(bidder.trustScore ?? 0) < minTrustScore
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
      const maxBidsPerMinute = await this.getPolicyNumber(
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

      const maxActiveAuctions = await this.getPolicyNumber(
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
      const maxRebidsPer10Min = await this.getPolicyNumber(
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
        const maxJumpMultiplier = await this.getPolicyNumber(
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
      const depositAmount = await this.getFixedDepositAmount(tx, listingId);

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

      const { topBids, activeBids } = await this.getTopActiveBids(
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
      const remaining = auction.endDatetime.getTime() - now.getTime();
      const shouldExtend =
        remaining > 0 && remaining <= LAST_MINUTE_EXTENSION_MINUTES * 60_000;
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
                    LAST_MINUTE_EXTENSION_MINUTES * 60_000,
                ),
              }
            : {}),
        },
      });

      return newBid;
    });

    this.appendAuctionLedgerEvent({
      event: 'BID_PLACED',
      listingId,
      actorUserId: userId,
      amount: bidAmount.toNumber(),
    });
    this.appendAuctionTimelineEvent({
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

  // -----------------------------------
  // Finalize auction
  // -----------------------------------
  async finalizeAuction(listingId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const auction = await tx.listingAuction.findUnique({
        where: { listingId },
      });

      if (!auction) throw new NotFoundException('مزایده یافت نشد');
      if (auction.status === AuctionStatus.FINISHED) return null;

      const topBids = await this.syncAuctionRanking(tx, listingId);
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

      const deadlineHours = await this.getWinnerPaymentDeadlineHours(tx);
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
      this.appendAuctionTimelineEvent({
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
    this.appendAuctionLedgerEvent({
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
      await this.getSecondChancePaymentDeadlineHours();
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
      const isSecondChanceRound =
        deadlineHours <= secondChancePaymentHours + 1;
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
          const winnerUser = await tx.user.findUnique({
            where: { id: currentWinnerBid.bidderId },
            select: { trustScore: true },
          });
          const currentTrust = Number(winnerUser?.trustScore ?? 100);
          await tx.user.update({
            where: { id: currentWinnerBid.bidderId },
            data: {
              trustScore: Math.max(0, currentTrust - 5),
            },
          });
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

      const deadlineHours = await this.getSecondChancePaymentDeadlineHours(tx);
      const ranking = await this.syncAuctionRanking(tx, listingId);
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

      this.appendAuctionTimelineEvent({
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
      const deadlineHours = await this.getWinnerPaymentDeadlineHours(tx);

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

  // -----------------------------------
  // Read APIs
  // -----------------------------------
  async getAuctionState(listingId: string, viewerUserId?: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      include: { listing: { select: { title: true, authorId: true } } },
    });

    if (!auction) throw new NotFoundException('مزایده یافت نشد');

    const bidCount = await this.prisma.auctionBid.count({
      where: { listingId },
    });
    const remainingMs =
      auction.status === AuctionStatus.ACTIVE
        ? Math.max(0, auction.endDatetime.getTime() - Date.now())
        : 0;

    const isOwner = !!viewerUserId && viewerUserId === auction.listing.authorId;
    const isHighestBidder =
      !!viewerUserId && viewerUserId === auction.highestBidderId;
    // ID برندگان فقط به خود کاربر (اگر برنده/دومه) و مالک آگهی نمایش داده میشه.
    // برای کاربران عمومی، فقط اطلاع از وجود/مبلغ میدیم نه هویت.
    return {
      listingId,
      title: auction.listing.title,
      auctionStatus: auction.status,
      basePrice: auction.basePrice,
      highestBid: auction.highestBidAmount,
      highestBidderId:
        isOwner || isHighestBidder ? auction.highestBidderId : null,
      isHighestBidder,
      bidCount,
      minBidIncrement: auction.minBidIncrement,
      buyNowEnabled: auction.buyNowEnabled,
      buyNowPrice: auction.buyNowPrice,
      endDatetime: auction.endDatetime,
      remainingMs,
      settlementStatus: auction.settlementStatus,
      paymentDeadline: auction.paymentDeadline,
    };
  }

  async getAuctionBids(listingId: string, viewerUserId?: string) {
    const auction = await this.prisma.listingAuction.findUnique({
      where: { listingId },
      select: { listing: { select: { authorId: true } } },
    });
    const isOwner =
      !!auction && !!viewerUserId && auction.listing.authorId === viewerUserId;

    const rows = await this.prisma.auctionBid.findMany({
      where: { listingId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        amount: true,
        bidderId: true,
        createdAt: true,
        status: true,
        bidder: { select: { firstName: true, lastName: true, avatar: true } },
      },
    });

    return rows.map((b) => ({
      amount: b.amount,
      createdAt: b.createdAt,
      status: b.status,
      // شناسه‌ی دقیق فقط به مالک و خود پیشنهاددهنده برمیگرده.
      bidderId: isOwner || b.bidderId === viewerUserId ? b.bidderId : null,
      isMine: b.bidderId === viewerUserId,
      bidder: {
        firstName: b.bidder?.firstName ?? null,
        // نمایش مخفف نام خانوادگی برای رعایت حریم خصوصی.
        lastName: b.bidder?.lastName ? `${b.bidder.lastName.charAt(0)}.` : null,
        avatar: b.bidder?.avatar ?? null,
      },
    }));
  }

  async getAuctionCheckoutData(listingId: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        auction: {
          include: {
            bids: {
              where: { bidderId: userId },
              orderBy: { amount: 'desc' },
              take: 1,
            },
          },
        },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    if (!listing || !listing.auction) {
      throw new NotFoundException('آگهی مزایده یافت نشد');
    }

    const userBid = listing.auction.bids[0];
    if (!userBid) {
      throw new ForbiddenException('شما هیچ پیشنهادی در این مزایده ندارید');
    }
    if (listing.auction.highestBidderId !== userId) {
      throw new ForbiddenException(
        'فقط برنده فعلی مجاز به ادامه پرداخت مزایده است',
      );
    }

    const finishedAt = listing.auction.finishedAt
      ? new Date(listing.auction.finishedAt).getTime()
      : 0;
    const deadlineAt = listing.auction.paymentDeadline
      ? new Date(listing.auction.paymentDeadline).getTime()
      : 0;
    const windowHours =
      finishedAt > 0 && deadlineAt > finishedAt
        ? (deadlineAt - finishedAt) / (60 * 60 * 1000)
        : null;
    const isSecondChanceRound = windowHours != null && windowHours <= 24 + 1;
    if (isSecondChanceRound) {
      const offered = await this.prisma.secondChanceOffer.findFirst({
        where: {
          listingId,
          userId,
          status: 'OFFERED',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (!offered) {
        throw new ForbiddenException('شانس دوم برای این کاربر فعال نیست');
      }
    }

    const bidAmount = new Decimal(userBid.amount);
    const depositPercent = await this.getAuctionDepositPercent(
      this.prisma,
      listingId,
    );
    const blockedAmount = await this.getFixedDepositAmount(
      this.prisma,
      listingId,
    );
    const payableAmount = bidAmount.minus(blockedAmount);

    return {
      listing: {
        id: listing.id,
        title: listing.title,
        thumbnail: listing.thumbnail,
        shippingPayer: listing.shippingPayer,
        author: listing.author,
      },
      bidAmount: bidAmount.toNumber(),
      blockedAmount: blockedAmount.toNumber(),
      payableAmount: payableAmount.toNumber(),
      depositPercent: depositPercent.toNumber(),
    };
  }

  // -----------------------------------
  // Admin Methods
  // -----------------------------------

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
