import { Injectable, NotFoundException } from '@nestjs/common';
import { ItemCondition, ListingType } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CurrencyService } from '../../currency/currency.service';
import { BASE_CURRENCY_CODE } from '../../currency/providers/fx-provider';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';

export type WordPressSellerCurrencyOption = {
  code: string;
  nameFa: string;
  symbol: string;
  decimals: number;
};

export type WordPressSellerContext = {
  allowedCurrencyCodes: string[];
  currencies: WordPressSellerCurrencyOption[];
};

@Injectable()
export class WordPressSellerContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
    private readonly feeCalculator: FeeCalculatorService,
  ) {}

  async getSellerContext(userId: string): Promise<WordPressSellerContext> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowedListingCurrencyCodes: true },
    });
    if (!user) {
      throw new NotFoundException('کاربر یافت نشد');
    }

    const allowedExtra = (user.allowedListingCurrencyCodes ?? [])
      .map((code) => this.currency.normalizeCode(code))
      .filter((code) => code !== BASE_CURRENCY_CODE);

    const allowedSet = new Set<string>([BASE_CURRENCY_CODE, ...allowedExtra]);
    const allowedCurrencyCodes = Array.from(allowedSet);

    const enabled = await this.currency.listPublicEnabled();
    const currencies = enabled
      .filter((row) => allowedSet.has(this.currency.normalizeCode(row.code)))
      .map((row) => ({
        code: row.code,
        nameFa: row.nameFa,
        symbol: row.symbol,
        decimals: row.decimals,
      }));

    // Ensure IRT is always present even if somehow missing from enabled list.
    if (!currencies.some((c) => c.code === BASE_CURRENCY_CODE)) {
      currencies.unshift({
        code: BASE_CURRENCY_CODE,
        nameFa: 'تومان',
        symbol: 'تومان',
        decimals: 0,
      });
    }

    return { allowedCurrencyCodes, currencies };
  }

  async getFeeRate(
    userId: string,
    categoryId?: string | null,
  ): Promise<{ feePercent: number }> {
    const feePercent = await this.feeCalculator.resolveListingFeePercent({
      categoryId,
      listingType: ListingType.DIRECT,
      condition: ItemCondition.NEW,
      sellerId: userId,
    });
    return { feePercent };
  }
}
