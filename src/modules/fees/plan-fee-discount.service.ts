import { Injectable } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export interface SellerDiscountInfo {
  /** The discount percent (0-90) that will be applied to the base fee. */
  discountPercent: number;
  /** Title of the plan providing the discount, if any. */
  planTitle: string | null;
  /** Unique identifier of the plan, if any. */
  planId: string | null;
  /** Subscription expiry date for the winning plan. */
  expiresAt: Date | null;
}

@Injectable()
export class PlanFeeDiscountService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * اگر فروشنده اشتراک فعال داشته باشد، بهترین تخفیف (کمترین ضریب کارمزد) اعمال می‌شود.
   * فقط برای DIRECT و AUCTION؛ درصد تخفیف از کارمزد نهایی محاسبه‌شده (نه از درصد پایه دسته).
   */
  async applySellerSubscriptionDiscount(
    sellerId: string,
    listingType: ListingType,
    baseFee: Decimal,
  ): Promise<Decimal> {
    if (
      listingType !== ListingType.DIRECT &&
      listingType !== ListingType.AUCTION
    ) {
      return baseFee;
    }
    if (baseFee.lte(0)) {
      return baseFee;
    }

    const info = await this.getSellerDiscount(sellerId, listingType);
    if (info.discountPercent <= 0) return baseFee;
    const mult = (100 - info.discountPercent) / 100;
    return baseFee.mul(mult).floor();
  }

  /**
   * Returns the best plan-based discount info that applies to the given seller and
   * listing type. Returns `discountPercent: 0` and `planTitle: null` when no active
   * subscription with discount is found, or when the listing type does not qualify
   * for plan discounts (e.g. EXCHANGE).
   */
  async getSellerDiscount(
    sellerId: string,
    listingType: ListingType,
  ): Promise<SellerDiscountInfo> {
    const empty: SellerDiscountInfo = {
      discountPercent: 0,
      planTitle: null,
      planId: null,
      expiresAt: null,
    };
    if (
      listingType !== ListingType.DIRECT &&
      listingType !== ListingType.AUCTION
    ) {
      return empty;
    }

    const now = new Date();
    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: { userId: sellerId, status: 'ACTIVE' },
      include: { plan: true },
    });

    let best: SellerDiscountInfo = empty;
    for (const p of purchases) {
      if (!p.plan) continue;
      const duration = Math.max(1, p.plan.durationDays ?? 365);
      const expiresAt = p.expiresAt ?? addDaysUtc(p.createdAt, duration);
      if (expiresAt.getTime() <= now.getTime()) continue;

      const raw =
        listingType === ListingType.DIRECT
          ? p.plan.feeDiscountDirectPercent ?? 0
          : p.plan.feeDiscountAuctionPercent ?? 0;
      const discountPct = Math.max(0, Math.min(90, Math.floor(Number(raw) || 0)));
      if (discountPct > best.discountPercent) {
        best = {
          discountPercent: discountPct,
          planTitle: p.plan.title,
          planId: p.plan.id,
          expiresAt,
        };
      }
    }
    return best;
  }
}
