import { Injectable } from '@nestjs/common';
import { ListingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';

export type CalculateFeeOptions = {
  /** برای اعمال تخفیف کارمزد بر اساس پلن/اشتراک فعال فروشنده */
  sellerId?: string;
};

export interface FeePreviewResult {
  /** کارمزد پایه قبل از اعمال تخفیف پلن. */
  baseFee: string;
  /** کارمزد نهایی پس از اعمال تخفیف پلن. */
  finalFee: string;
  /** درصد تخفیف اعمال‌شده (۰–۹۰). */
  discountPercent: number;
  /** مبلغ صرفه‌جویی (baseFee - finalFee). */
  discountAmount: string;
  /** عنوان پلن اعمال‌کننده تخفیف، در صورت وجود. */
  planTitle: string | null;
  /** شناسه پلن اعمال‌کننده تخفیف، در صورت وجود. */
  planId: string | null;
  /** تاریخ انقضای اشتراک پلن، در صورت وجود. */
  planExpiresAt: string | null;
}

@Injectable()
export class FeeCalculatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly planFeeDiscount: PlanFeeDiscountService,
  ) {}

  async calculateFee(
    listingType: ListingType,
    categoryId: string | null,
    amount: number | string | Decimal,
    options?: CalculateFeeOptions,
  ): Promise<Decimal> {
    const targetAmount = new Decimal(amount);

    if (targetAmount.lte(0)) {
      return new Decimal(0);
    }

    let totalFee: Decimal;

    const rules = await this.prisma.feeRule.findMany({
      where: {
        listingType,
        isActive: true,
        OR: [{ categoryId: categoryId }, { categoryId: null }],
        minPrice: { lte: targetAmount.toString() },
      },
      orderBy: [
        { categoryId: 'desc' },
        { minPrice: 'desc' },
      ],
    });

    if (rules.length === 0) {
      if (categoryId) {
        const category = await this.prisma.category.findUnique({
          where: { id: categoryId },
        });

        if (category) {
          const percentageFee = targetAmount
            .mul(new Decimal(category.feePercentage))
            .div(new Decimal(100));

          let fee = percentageFee;

          if (category.feeCap && new Decimal(category.feeCap).gt(0)) {
            const cap = new Decimal(category.feeCap);
            if (fee.gt(cap)) {
              fee = cap;
            }
          }

          totalFee = fee.floor();
        } else {
          totalFee = new Decimal(0);
        }
      } else {
        totalFee = new Decimal(0);
      }
    } else {
      const applicableRule =
        rules.find((rule) => {
          if (!rule.maxPrice) return true;
          return targetAmount.lte(new Decimal(rule.maxPrice));
        }) || rules[0];

      const percentageFee = targetAmount
        .mul(new Decimal(applicableRule.feePercent))
        .div(new Decimal(100));

      let fee = percentageFee.plus(new Decimal(applicableRule.feeFixed));

      if (applicableRule.feeCap && new Decimal(applicableRule.feeCap).gt(0)) {
        const cap = new Decimal(applicableRule.feeCap);
        if (fee.gt(cap)) {
          fee = cap;
        }
      }

      totalFee = fee.floor();
    }

    if (options?.sellerId) {
      return this.planFeeDiscount.applySellerSubscriptionDiscount(
        options.sellerId,
        listingType,
        totalFee,
      );
    }

    return totalFee;
  }

  /**
   * Returns a structured preview of the fee for a given listing scenario. Mirrors
   * the calculation used at settlement time so the seller can see exactly how their
   * active plan discount affects the platform fee before publishing the listing.
   */
  async previewFee(
    listingType: ListingType,
    categoryId: string | null,
    amount: number | string | Decimal,
    sellerId?: string,
  ): Promise<FeePreviewResult> {
    const baseFee = await this.calculateFee(listingType, categoryId, amount);
    const discount = sellerId
      ? await this.planFeeDiscount.getSellerDiscount(sellerId, listingType)
      : {
          discountPercent: 0,
          planTitle: null,
          planId: null,
          expiresAt: null,
        };

    const mult = (100 - discount.discountPercent) / 100;
    const finalFee = baseFee.mul(mult).floor();
    const discountAmount = baseFee.minus(finalFee);

    return {
      baseFee: baseFee.toString(),
      finalFee: finalFee.toString(),
      discountPercent: discount.discountPercent,
      discountAmount: discountAmount.toString(),
      planTitle: discount.planTitle,
      planId: discount.planId,
      planExpiresAt: discount.expiresAt ? discount.expiresAt.toISOString() : null,
    };
  }
}
