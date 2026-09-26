import { Injectable } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function toNonNegDecimal(raw: unknown): Decimal {
  try {
    const d = new Decimal(raw as Decimal.Value);
    if (!d.isFinite() || d.lte(0)) return new Decimal(0);
    return d;
  } catch {
    return new Decimal(0);
  }
}

export interface SellerDiscountInfo {
  /** The discount percent (0-90) that will be applied to the base fee. */
  discountPercent: number;
  /** کف کارمزد نهایی (تومان)؛ ۰ یعنی بدون کف. */
  feeFloor: Decimal;
  /** سقف کارمزد نهایی (تومان)؛ ۰ یعنی بدون سقف. */
  feeCap: Decimal;
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
   * اگر فروشنده اشتراک فعال داشته باشد، بهترین تخفیف (کمترین ضریب کارمزد) اعمال می‌شود
   * و سپس کف/سقف همان پلن روی مبلغ نهایی اعمال می‌گردد.
   * فقط برای DIRECT و AUCTION.
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
    return this.applyDiscountAndBounds(baseFee, info);
  }

  /** تخفیف درصدی سپس کف/سقف پلن (همان منطق تسویه و پیش‌نمایش). */
  applyDiscountAndBounds(baseFee: Decimal, info: SellerDiscountInfo): Decimal {
    let fee = baseFee;
    if (info.discountPercent > 0) {
      const mult = (100 - info.discountPercent) / 100;
      fee = fee.mul(mult);
    }
    if (info.feeFloor.gt(0) && fee.lt(info.feeFloor)) {
      fee = info.feeFloor;
    }
    if (info.feeCap.gt(0) && fee.gt(info.feeCap)) {
      fee = info.feeCap;
    }
    return fee.floor();
  }

  /**
   * Returns the best plan-based discount info that applies to the given seller and
   * listing type. Returns `discountPercent: 0` and `planTitle: null` when no active
   * subscription with discount/bounds is found, or when the listing type does not qualify
   * for plan discounts (e.g. EXCHANGE).
   */
  async getSellerDiscount(
    sellerId: string,
    listingType: ListingType,
  ): Promise<SellerDiscountInfo> {
    const empty: SellerDiscountInfo = {
      discountPercent: 0,
      feeFloor: new Decimal(0),
      feeCap: new Decimal(0),
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

      const isDirect = listingType === ListingType.DIRECT;
      const rawDisc = isDirect
        ? (p.plan.feeDiscountDirectPercent ?? 0)
        : (p.plan.feeDiscountAuctionPercent ?? 0);
      const discountPct = Math.max(
        0,
        Math.min(90, Math.floor(Number(rawDisc) || 0)),
      );
      const feeFloor = toNonNegDecimal(
        isDirect ? p.plan.feeFloorDirect : p.plan.feeFloorAuction,
      );
      const feeCap = toNonNegDecimal(
        isDirect ? p.plan.feeCapDirect : p.plan.feeCapAuction,
      );

      if (discountPct <= 0 && feeFloor.lte(0) && feeCap.lte(0)) continue;

      const betterDiscount = discountPct > best.discountPercent;
      const sameDiscountFirstPlan =
        discountPct === best.discountPercent && !best.planId;
      if (betterDiscount || sameDiscountFirstPlan) {
        best = {
          discountPercent: discountPct,
          feeFloor,
          feeCap,
          planTitle: p.plan.title,
          planId: p.plan.id,
          expiresAt,
        };
      }
    }
    return best;
  }
}
