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

import { appendJsonLog } from '../../../common/logging/app-log.util';
import { readPositiveIntSetting } from '../../../common/system-settings/numeric-setting.util';
import {
  TOP_BIDDERS_LIMIT,
  DEFAULT_LAST_MINUTE_EXTENSION_MINUTES,
  DEFAULT_WINNER_PAYMENT_DEADLINE_HOURS,
  DEFAULT_SECOND_CHANCE_PAYMENT_DEADLINE_HOURS,
  DEFAULT_AUCTION_DEPOSIT_MIN,
  DEFAULT_AUCTION_DEPOSIT_MAX,
  DEFAULT_MAX_BIDS_PER_MINUTE,
  DEFAULT_MAX_ACTIVE_AUCTIONS_PER_USER,
  DEFAULT_MAX_REBIDS_PER_10_MIN,
  DEFAULT_MAX_BID_JUMP_MULTIPLIER,
  MIN_TRUST_SCORE_FOR_AUCTION,
} from '../auction.constants';

@Injectable()
export class AuctionSupportService {
  constructor(private readonly prisma: PrismaService) {}

  appendAuctionLedgerEvent(payload: Record<string, unknown>) {
    appendJsonLog('auction-ledger.log', {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  appendAuctionTimelineEvent(payload: Record<string, unknown>) {
    appendJsonLog('auction-timeline.log', {
      ts: new Date().toISOString(),
      ...payload,
    });
  }

  async getWinnerPaymentDeadlineHours(tx: any): Promise<number> {
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

  async getSecondChancePaymentDeadlineHours(tx?: any): Promise<number> {
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

  async getLastMinuteExtensionMinutes(tx: any): Promise<number> {
    return readPositiveIntSetting(
      tx,
      'AUCTION_LAST_MINUTE_EXTENSION_MINUTES',
      DEFAULT_LAST_MINUTE_EXTENSION_MINUTES,
    );
  }

  async getNumericSetting(
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

  async getPolicyNumber(
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

  async getAuctionDepositPercent(
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

  async getFixedDepositAmount(
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

  async getTopActiveBids(tx: any, listingId: string) {
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

  async syncAuctionRanking(tx: any, listingId: string) {
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
}
