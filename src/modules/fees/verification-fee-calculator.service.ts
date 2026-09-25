import { Injectable } from '@nestjs/common';
import { Prisma, VerificationFeeMode } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

export const DEFAULT_VERIFICATION_FEE_FALLBACK = 250_000;

type DbClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class VerificationFeeCalculatorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves کارشناسی fee for a product by category + price.
   * Priority: category-specific rule > global (null category); then highest minPrice that still matches.
   * Mode is exclusive: FIXED or PERCENT.
   * For PERCENT: optional feeFloor then feeCap clamp the final amount.
   * Falls back to SystemSetting VERIFICATION_FEE (or 250000) when no rule matches.
   */
  async resolve(
    categoryId: string | null | undefined,
    price: number | string | Decimal,
    client?: DbClient,
  ): Promise<number> {
    const db = client ?? this.prisma;
    const targetAmount = new Decimal(price || 0);
    if (targetAmount.lt(0)) {
      return 0;
    }

    const catId = categoryId || null;
    const rules = await db.verificationFeeRule.findMany({
      where: {
        isActive: true,
        OR: [{ categoryId: catId }, { categoryId: null }],
        minPrice: { lte: targetAmount.toString() },
      },
      orderBy: [{ categoryId: 'desc' }, { minPrice: 'desc' }],
    });

    const applicable = rules.find((rule) => {
      if (rule.maxPrice == null) return true;
      return targetAmount.lte(new Decimal(rule.maxPrice));
    });

    if (!applicable) {
      return this.readFallbackFee(db);
    }

    let fee =
      applicable.mode === VerificationFeeMode.PERCENT
        ? targetAmount
            .mul(new Decimal(applicable.feeValue))
            .div(new Decimal(100))
        : new Decimal(applicable.feeValue);

    if (applicable.mode === VerificationFeeMode.PERCENT) {
      if (
        applicable.feeFloor != null &&
        new Decimal(applicable.feeFloor).gt(0) &&
        fee.lt(new Decimal(applicable.feeFloor))
      ) {
        fee = new Decimal(applicable.feeFloor);
      }
      if (applicable.feeCap != null && new Decimal(applicable.feeCap).gt(0)) {
        const cap = new Decimal(applicable.feeCap);
        if (fee.gt(cap)) {
          fee = cap;
        }
      }
    }

    return Math.max(0, fee.floor().toNumber());
  }

  private async readFallbackFee(db: DbClient): Promise<number> {
    const row = await db.systemSetting.findUnique({
      where: { key: 'VERIFICATION_FEE' },
    });
    const n = Number(row?.value);
    if (Number.isFinite(n) && n >= 0) {
      return Math.floor(n);
    }
    return DEFAULT_VERIFICATION_FEE_FALLBACK;
  }
}
