import { Injectable } from '@nestjs/common';
import { ItemCondition, ListingType } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';

export type CalculateFeeOptions = {
  /** برای اعمال تخفیف کارمزد بر اساس پلن/اشتراک فعال فروشنده */
  sellerId?: string;
  /** شرط کالا — نو یا کارکرده؛ پیش‌فرض NEW */
  condition?: ItemCondition | null;
};

export interface FeePreviewResult {
  /** کارمزد پایه قبل از اعمال تخفیف پلن. */
  baseFee: string;
  /** کارمزد نهایی پس از اعمال تخفیف پلن. */
  finalFee: string;
  /** درصد تخفیف اعمال‌شده (۰–۹۰). */
  discountPercent: number;
  /** کف کارمزد پلن (تومان؛ ۰ = بدون کف). */
  feeFloor: string;
  /** سقف کارمزد پلن (تومان؛ ۰ = بدون سقف). */
  feeCap: string;
  /** مبلغ صرفه‌جویی (baseFee - finalFee). */
  discountAmount: string;
  /** عنوان پلن اعمال‌کننده تخفیف، در صورت وجود. */
  planTitle: string | null;
  /** شناسه پلن اعمال‌کننده تخفیف، در صورت وجود. */
  planId: string | null;
  /** تاریخ انقضای اشتراک پلن، در صورت وجود. */
  planExpiresAt: string | null;
}

type CategoryFeeRow = {
  feePercentage: number;
  feeCap: Decimal | null;
  feeFloor?: Decimal | null;
  feePercentageDirect: number;
  feeCapDirect: Decimal | null;
  feeFloorDirect?: Decimal | null;
  feePercentageAuction: number;
  feeCapAuction: Decimal | null;
  feeFloorAuction?: Decimal | null;
  feePercentageDirectNew: number;
  feePercentageDirectUsed: number;
  feePercentageAuctionNew: number;
  feePercentageAuctionUsed: number;
};

type UserFeeOverrideRow = {
  feePercentageDirectNew: number | null;
  feePercentageDirectUsed: number | null;
  feePercentageAuctionNew: number | null;
  feePercentageAuctionUsed: number | null;
  auctionDepositPercentNew: number | null;
  auctionDepositPercentUsed: number | null;
};

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

    const condition = options?.condition ?? ItemCondition.NEW;
    let totalFee: Decimal;

    // 1) Per-user override for this seller + category + condition
    if (options?.sellerId && categoryId) {
      const userPct = await this.resolveUserFeePercent(
        options.sellerId,
        categoryId,
        listingType,
        condition,
      );
      if (userPct !== null) {
        const category = await this.prisma.category.findUnique({
          where: { id: categoryId },
        });
        let fee = targetAmount.mul(userPct).div(new Decimal(100));
        if (category) {
          const { floor, cap } = this.resolveCategoryFeeParams(
            category,
            listingType,
            condition,
          );
          fee = this.applyFloorAndCap(fee, floor, cap);
        }
        totalFee = fee.floor();
        return this.applyPlanDiscount(totalFee, options.sellerId, listingType);
      }
    }

    // 2) FeeRule
    const rules = await this.prisma.feeRule.findMany({
      where: {
        listingType,
        isActive: true,
        OR: [{ categoryId: categoryId }, { categoryId: null }],
        minPrice: { lte: targetAmount.toString() },
      },
      orderBy: [{ categoryId: 'desc' }, { minPrice: 'desc' }],
    });

    if (rules.length === 0) {
      // 3) Category condition-specific defaults
      if (categoryId) {
        const category = await this.prisma.category.findUnique({
          where: { id: categoryId },
        });

        if (category) {
          const { percentage, floor, cap } = this.resolveCategoryFeeParams(
            category,
            listingType,
            condition,
          );

          let fee = targetAmount.mul(percentage).div(new Decimal(100));
          fee = this.applyFloorAndCap(fee, floor, cap);

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

    return this.applyPlanDiscount(totalFee, options?.sellerId, listingType);
  }

  private async applyPlanDiscount(
    totalFee: Decimal,
    sellerId: string | undefined,
    listingType: ListingType,
  ): Promise<Decimal> {
    if (!sellerId) return totalFee;
    return this.planFeeDiscount.applySellerSubscriptionDiscount(
      sellerId,
      listingType,
      totalFee,
    );
  }

  /**
   * Returns user override percent for the listing type + condition, or null if unset.
   */
  async resolveUserFeePercent(
    userId: string,
    categoryId: string,
    listingType: ListingType,
    condition: ItemCondition,
  ): Promise<number | null> {
    const row = await this.prisma.userCategoryFee.findUnique({
      where: {
        userId_categoryId: { userId, categoryId },
      },
    });
    if (!row) return null;
    return this.pickUserFeePercent(row, listingType, condition);
  }

  /**
   * Resolves auction deposit % with priority: user override → FeeRule → category condition.
   */
  async resolveAuctionDepositPercent(params: {
    categoryId: string | null;
    condition?: ItemCondition | null;
    sellerId?: string | null;
    feeRuleDepositPercent?: number | null;
  }): Promise<number> {
    const condition = params.condition ?? ItemCondition.NEW;

    if (params.sellerId && params.categoryId) {
      const row = await this.prisma.userCategoryFee.findUnique({
        where: {
          userId_categoryId: {
            userId: params.sellerId,
            categoryId: params.categoryId,
          },
        },
      });
      const fromUser = this.pickUserDepositPercent(row, condition);
      if (fromUser !== null) return fromUser;
    }

    if (
      params.feeRuleDepositPercent != null &&
      Number.isFinite(params.feeRuleDepositPercent) &&
      params.feeRuleDepositPercent > 0
    ) {
      return params.feeRuleDepositPercent;
    }

    if (params.categoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: params.categoryId },
        select: {
          auctionDepositPercent: true,
          auctionDepositPercentNew: true,
          auctionDepositPercentUsed: true,
        },
      });
      if (category) {
        return this.pickCategoryDepositPercent(category, condition);
      }
    }

    return 10;
  }

  pickUserFeePercent(
    row: UserFeeOverrideRow | null | undefined,
    listingType: ListingType,
    condition: ItemCondition,
  ): number | null {
    if (!row) return null;
    const isUsed = condition === ItemCondition.USED;
    if (listingType === ListingType.AUCTION) {
      const v = isUsed
        ? row.feePercentageAuctionUsed
        : row.feePercentageAuctionNew;
      return v == null ? null : v;
    }
    const v = isUsed
      ? row.feePercentageDirectUsed
      : row.feePercentageDirectNew;
    return v == null ? null : v;
  }

  pickUserDepositPercent(
    row: UserFeeOverrideRow | null | undefined,
    condition: ItemCondition,
  ): number | null {
    if (!row) return null;
    const v =
      condition === ItemCondition.USED
        ? row.auctionDepositPercentUsed
        : row.auctionDepositPercentNew;
    return v == null ? null : v;
  }

  pickCategoryDepositPercent(
    category: {
      auctionDepositPercent: number;
      auctionDepositPercentNew?: number | null;
      auctionDepositPercentUsed?: number | null;
    },
    condition: ItemCondition,
  ): number {
    if (condition === ItemCondition.USED) {
      return (
        category.auctionDepositPercentUsed ??
        category.auctionDepositPercent ??
        10
      );
    }
    return (
      category.auctionDepositPercentNew ??
      category.auctionDepositPercent ??
      10
    );
  }

  resolveCategoryFeeParams(
    category: CategoryFeeRow,
    listingType: ListingType,
    condition: ItemCondition = ItemCondition.NEW,
  ): { percentage: Decimal; floor: Decimal | null; cap: Decimal | null } {
    const isUsed = condition === ItemCondition.USED;

    if (listingType === ListingType.AUCTION) {
      const percentage =
        (isUsed
          ? category.feePercentageAuctionUsed
          : category.feePercentageAuctionNew) ??
        category.feePercentageAuction ??
        category.feePercentage;
      const capValue = category.feeCapAuction ?? category.feeCap;
      const floorValue = category.feeFloorAuction ?? category.feeFloor ?? null;
      return {
        percentage: new Decimal(percentage),
        floor: floorValue != null ? new Decimal(floorValue) : null,
        cap: capValue ? new Decimal(capValue) : null,
      };
    }

    const percentage =
      (isUsed
        ? category.feePercentageDirectUsed
        : category.feePercentageDirectNew) ??
      category.feePercentageDirect ??
      category.feePercentage;
    const capValue = category.feeCapDirect ?? category.feeCap;
    const floorValue = category.feeFloorDirect ?? category.feeFloor ?? null;
    return {
      percentage: new Decimal(percentage),
      floor: floorValue != null ? new Decimal(floorValue) : null,
      cap: capValue ? new Decimal(capValue) : null,
    };
  }

  /** Clamp fee to [floor, cap] when those bounds are positive. */
  applyFloorAndCap(
    fee: Decimal,
    floor: Decimal | null,
    cap: Decimal | null,
  ): Decimal {
    let result = fee;
    if (floor && floor.gt(0) && result.lt(floor)) {
      result = floor;
    }
    if (cap && cap.gt(0) && result.gt(cap)) {
      result = cap;
    }
    return result;
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
    condition?: ItemCondition | null,
  ): Promise<FeePreviewResult> {
    const resolvedBase = await this.calculateBaseFeeWithOverrides(
      listingType,
      categoryId,
      amount,
      sellerId,
      condition,
    );

    const discount = sellerId
      ? await this.planFeeDiscount.getSellerDiscount(sellerId, listingType)
      : {
          discountPercent: 0,
          feeFloor: new Decimal(0),
          feeCap: new Decimal(0),
          planTitle: null,
          planId: null,
          expiresAt: null,
        };

    const finalFee = this.planFeeDiscount.applyDiscountAndBounds(
      resolvedBase,
      discount,
    );
    const discountAmount = resolvedBase.minus(finalFee);

    return {
      baseFee: resolvedBase.toString(),
      finalFee: finalFee.toString(),
      discountPercent: discount.discountPercent,
      feeFloor: discount.feeFloor.toString(),
      feeCap: discount.feeCap.toString(),
      discountAmount: discountAmount.toString(),
      planTitle: discount.planTitle,
      planId: discount.planId,
      planExpiresAt: discount.expiresAt
        ? discount.expiresAt.toISOString()
        : null,
    };
  }

  /** Base fee including optional user override, excluding plan discount. */
  private async calculateBaseFeeWithOverrides(
    listingType: ListingType,
    categoryId: string | null,
    amount: number | string | Decimal,
    sellerId?: string,
    condition?: ItemCondition | null,
  ): Promise<Decimal> {
    const targetAmount = new Decimal(amount);
    if (targetAmount.lte(0)) return new Decimal(0);

    const cond = condition ?? ItemCondition.NEW;

    if (sellerId && categoryId) {
      const userPct = await this.resolveUserFeePercent(
        sellerId,
        categoryId,
        listingType,
        cond,
      );
      if (userPct !== null) {
        const category = await this.prisma.category.findUnique({
          where: { id: categoryId },
        });
        let fee = targetAmount.mul(userPct).div(new Decimal(100));
        if (category) {
          const { floor, cap } = this.resolveCategoryFeeParams(
            category,
            listingType,
            cond,
          );
          fee = this.applyFloorAndCap(fee, floor, cap);
        }
        return fee.floor();
      }
    }

    return this.calculateFee(listingType, categoryId, amount, {
      condition: cond,
    });
  }
}
