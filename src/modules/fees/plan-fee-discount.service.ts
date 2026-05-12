import { Injectable } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
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

    const now = new Date();
    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: {
        userId: sellerId,
        status: 'ACTIVE',
      },
      include: { plan: true },
    });

    let bestMultiplier = 1;

    for (const p of purchases) {
      const duration = Math.max(1, p.plan.durationDays ?? 365);
      const expiresAt =
        p.expiresAt ?? addDaysUtc(p.createdAt, duration);
      if (expiresAt.getTime() <= now.getTime()) {
        continue;
      }

      const raw =
        listingType === ListingType.DIRECT
          ? p.plan.feeDiscountDirectPercent ?? 0
          : p.plan.feeDiscountAuctionPercent ?? 0;
      const discountPct = Math.max(0, Math.min(90, Math.floor(Number(raw) || 0)));
      const mult = (100 - discountPct) / 100;
      bestMultiplier = Math.min(bestMultiplier, mult);
    }

    return baseFee.mul(bestMultiplier).floor();
  }
}
