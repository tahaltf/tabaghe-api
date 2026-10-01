import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ListingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BASE_CURRENCY_CODE } from './providers/fx-provider';
import type { FxIngestRatesDto } from './dto/fx-ingest.dto';

export type EffectiveRate = {
  currencyCode: string;
  rateToToman: number;
  source: string;
  fetchedAt: Date | null;
  isOverride: boolean;
};

export type CurrencyPublicDto = {
  code: string;
  nameFa: string;
  symbol: string;
  decimals: number;
  isEnabled: boolean;
  sortOrder: number;
  rateToToman: number | null;
  rateUpdatedAt: string | null;
  rateSource: string | null;
};

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  normalizeCode(code?: string | null): string {
    const c = (code ?? BASE_CURRENCY_CODE).trim().toUpperCase();
    return c || BASE_CURRENCY_CODE;
  }

  isBaseCurrency(code?: string | null): boolean {
    return this.normalizeCode(code) === BASE_CURRENCY_CODE;
  }

  async listPublicEnabled(): Promise<CurrencyPublicDto[]> {
    const rows = await this.prisma.currency.findMany({
      where: { isEnabled: true },
      include: { rate: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => this.toPublicDto(r));
  }

  async listAllAdmin() {
    const rows = await this.prisma.currency.findMany({
      include: { rate: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
    return rows.map((r) => ({
      ...this.toPublicDto(r),
      manualOverride: r.rate?.manualOverride
        ? Number(r.rate.manualOverride)
        : null,
      overrideUntil: r.rate?.overrideUntil?.toISOString() ?? null,
    }));
  }

  async setEnabled(code: string, isEnabled: boolean) {
    const c = this.normalizeCode(code);
    if (c === BASE_CURRENCY_CODE && !isEnabled) {
      throw new BadRequestException('تومان همیشه فعال است و غیرفعال نمی‌شود');
    }
    const row = await this.prisma.currency.findUnique({ where: { code: c } });
    if (!row) throw new NotFoundException('ارز یافت نشد');
    return this.prisma.currency.update({
      where: { code: c },
      data: { isEnabled },
      include: { rate: true },
    });
  }

  async setManualOverride(
    code: string,
    rateToToman: number,
    overrideUntil?: Date | null,
  ) {
    const c = this.normalizeCode(code);
    if (c === BASE_CURRENCY_CODE) {
      throw new BadRequestException('نرخ تومان ثابت است');
    }
    if (!Number.isFinite(rateToToman) || rateToToman <= 0) {
      throw new BadRequestException('نرخ نامعتبر است');
    }
    const row = await this.prisma.currency.findUnique({ where: { code: c } });
    if (!row) throw new NotFoundException('ارز یافت نشد');

    await this.prisma.currencyRate.upsert({
      where: { currencyCode: c },
      create: {
        currencyCode: c,
        rateToToman,
        source: 'manual',
        fetchedAt: new Date(),
        manualOverride: rateToToman,
        overrideUntil: overrideUntil ?? null,
      },
      update: {
        manualOverride: rateToToman,
        overrideUntil: overrideUntil ?? null,
        source: 'manual',
      },
    });

    await this.refreshListingPriceCacheForCurrency(c);
    return this.listAllAdmin();
  }

  async clearManualOverride(code: string) {
    const c = this.normalizeCode(code);
    await this.prisma.currencyRate.updateMany({
      where: { currencyCode: c },
      data: { manualOverride: null, overrideUntil: null },
    });
    await this.refreshListingPriceCacheForCurrency(c);
    return this.listAllAdmin();
  }

  async getEffectiveRate(code: string): Promise<EffectiveRate> {
    const c = this.normalizeCode(code);
    if (c === BASE_CURRENCY_CODE) {
      return {
        currencyCode: c,
        rateToToman: 1,
        source: 'manual',
        fetchedAt: new Date(),
        isOverride: false,
      };
    }

    const row = await this.prisma.currencyRate.findUnique({
      where: { currencyCode: c },
    });
    if (!row) {
      throw new BadRequestException(`نرخ ارز ${c} موجود نیست`);
    }

    const now = new Date();
    const overrideActive =
      row.manualOverride != null &&
      Number(row.manualOverride) > 0 &&
      (row.overrideUntil == null || row.overrideUntil > now);

    const rate = overrideActive
      ? Number(row.manualOverride)
      : Number(row.rateToToman);

    if (!Number.isFinite(rate) || rate <= 0) {
      throw new BadRequestException(
        `نرخ ارز ${c} هنوز دریافت نشده است. لطفاً بعداً تلاش کنید یا ادمین نرخ را تنظیم کند.`,
      );
    }

    return {
      currencyCode: c,
      rateToToman: rate,
      source: overrideActive ? 'manual' : row.source,
      fetchedAt: row.fetchedAt,
      isOverride: overrideActive,
    };
  }

  async toToman(amount: number, currencyCode?: string | null): Promise<number> {
    const rate = await this.getEffectiveRate(currencyCode);
    return this.applyRate(amount, rate.rateToToman);
  }

  applyRate(amount: number, rateToToman: number): number {
    const a = Number(amount);
    const r = Number(rateToToman);
    if (!Number.isFinite(a) || a < 0) return 0;
    if (!Number.isFinite(r) || r <= 0) return 0;
    return Math.round(a * r);
  }

  /**
   * کاربر همیشه می‌تواند IRT استفاده کند.
   * برای سایر ارزها باید در allowedListingCurrencyCodes باشد و ارز فعال باشد.
   */
  async assertUserCanUseCurrency(
    userId: string,
    currencyCode: string | null | undefined,
    listingType: ListingType,
  ): Promise<string> {
    const code = this.normalizeCode(currencyCode);

    if (listingType === ListingType.AUCTION && code !== BASE_CURRENCY_CODE) {
      throw new BadRequestException('مزایده فقط با تومان قابل ثبت است');
    }

    if (code === BASE_CURRENCY_CODE) return code;

    const currency = await this.prisma.currency.findUnique({
      where: { code },
      include: { rate: true },
    });
    if (!currency || !currency.isEnabled) {
      throw new BadRequestException(`ارز ${code} در پلتفرم فعال نیست`);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { allowedListingCurrencyCodes: true },
    });
    const allowed = user?.allowedListingCurrencyCodes ?? [];
    if (!allowed.map((x) => x.toUpperCase()).includes(code)) {
      throw new BadRequestException(
        `شما مجاز به قیمت‌گذاری با ارز ${currency.nameFa} نیستید`,
      );
    }

    // Ensure a usable rate exists
    await this.getEffectiveRate(code);
    return code;
  }

  /**
   * دریافت نرخ از n8n / اتوماسیون خارجی و ذخیره در CurrencyRate.
   * سپس کش تومان آگهی‌های همان ارز به‌روز می‌شود.
   */
  async ingestRates(dto: FxIngestRatesDto): Promise<{
    updated: string[];
    skipped: string[];
    source: string;
  }> {
    const source = (dto.source?.trim() || 'n8n').slice(0, 64);
    const unit = dto.unit === 'rial' ? 'rial' : 'toman';
    const fetchedAt = new Date();
    const updated: string[] = [];
    const skipped: string[] = [];

    for (const item of dto.rates) {
      const code = this.normalizeCode(item.code);
      if (code === BASE_CURRENCY_CODE) {
        skipped.push(code);
        continue;
      }

      const exists = await this.prisma.currency.findUnique({
        where: { code },
        select: { code: true },
      });
      if (!exists) {
        this.logger.warn(`FX ingest skipped unknown currency: ${code}`);
        skipped.push(code);
        continue;
      }

      let rate = Number(item.rateToToman);
      if (unit === 'rial') rate = rate / 10;
      if (!Number.isFinite(rate) || rate <= 0) {
        skipped.push(code);
        continue;
      }

      await this.prisma.currencyRate.upsert({
        where: { currencyCode: code },
        create: {
          currencyCode: code,
          rateToToman: rate,
          source,
          fetchedAt,
        },
        update: {
          rateToToman: rate,
          source,
          fetchedAt,
        },
      });
      updated.push(code);
      await this.refreshListingPriceCacheForCurrency(code);
    }

    this.logger.log(
      `FX ingest source=${source} updated=${updated.join(',') || '-'} skipped=${skipped.join(',') || '-'}`,
    );
    return { updated, skipped, source };
  }

  async refreshListingPriceCacheForCurrency(currencyCode: string) {
    const code = this.normalizeCode(currencyCode);
    if (code === BASE_CURRENCY_CODE) return;

    let rate: EffectiveRate;
    try {
      rate = await this.getEffectiveRate(code);
    } catch {
      return;
    }

    const listings = await this.prisma.listing.findMany({
      where: {
        priceCurrencyCode: code,
        deletedAt: null,
        type: { in: [ListingType.DIRECT, ListingType.EXCHANGE] },
      },
      include: {
        direct: true,
        exchange: true,
      },
    });

    for (const listing of listings) {
      const foreign = this.resolveForeignUnitAmount(listing);
      const toman = this.applyRate(foreign, rate.rateToToman);
      await this.prisma.listing.update({
        where: { id: listing.id },
        data: { priceTomanCached: toman },
      });
    }
  }

  resolveForeignUnitAmount(listing: {
    type: ListingType;
    direct: {
      price: Prisma.Decimal | number;
      salePrice: Prisma.Decimal | number | null;
    } | null;
    exchange: {
      ownValue: Prisma.Decimal | number;
      directPrice: Prisma.Decimal | number | null;
    } | null;
  }): number {
    if (listing.type === ListingType.DIRECT && listing.direct) {
      const base = Number(listing.direct.price);
      const sale =
        listing.direct.salePrice != null
          ? Number(listing.direct.salePrice)
          : null;
      if (sale != null && sale > 0 && sale < base) return sale;
      return base;
    }
    if (listing.type === ListingType.EXCHANGE && listing.exchange) {
      if (
        listing.exchange.directPrice != null &&
        Number(listing.exchange.directPrice) > 0
      ) {
        return Number(listing.exchange.directPrice);
      }
      return Number(listing.exchange.ownValue);
    }
    return 0;
  }

  async computePriceTomanCached(params: {
    type: ListingType;
    priceCurrencyCode: string;
    direct?: {
      price?: number | null;
      salePrice?: number | null;
    } | null;
    exchange?: {
      ownValue?: number | null;
      directPrice?: number | null;
    } | null;
    auction?: { basePrice?: number | null } | null;
  }): Promise<number> {
    const code = this.normalizeCode(params.priceCurrencyCode);
    let foreign = 0;
    if (params.type === ListingType.DIRECT) {
      const base = Number(params.direct?.price ?? 0);
      const sale =
        params.direct?.salePrice != null
          ? Number(params.direct.salePrice)
          : null;
      foreign =
        sale != null && sale > 0 && sale < base ? sale : base;
    } else if (params.type === ListingType.EXCHANGE) {
      const dp = params.exchange?.directPrice;
      foreign =
        dp != null && Number(dp) > 0
          ? Number(dp)
          : Number(params.exchange?.ownValue ?? 0);
    } else {
      foreign = Number(params.auction?.basePrice ?? 0);
    }

    if (code === BASE_CURRENCY_CODE) return Math.round(foreign);
    const rate = await this.getEffectiveRate(code);
    return this.applyRate(foreign, rate.rateToToman);
  }

  private toPublicDto(r: {
    code: string;
    nameFa: string;
    symbol: string;
    decimals: number;
    isEnabled: boolean;
    sortOrder: number;
    rate: {
      rateToToman: Prisma.Decimal;
      source: string;
      fetchedAt: Date | null;
      manualOverride: Prisma.Decimal | null;
      overrideUntil: Date | null;
      updatedAt: Date;
    } | null;
  }): CurrencyPublicDto {
    let rateToToman: number | null = null;
    let rateUpdatedAt: string | null = null;
    let rateSource: string | null = null;

    if (r.code === BASE_CURRENCY_CODE) {
      rateToToman = 1;
      rateUpdatedAt = new Date().toISOString();
      rateSource = 'manual';
    } else if (r.rate) {
      const now = new Date();
      const overrideActive =
        r.rate.manualOverride != null &&
        Number(r.rate.manualOverride) > 0 &&
        (r.rate.overrideUntil == null || r.rate.overrideUntil > now);
      const rate = overrideActive
        ? Number(r.rate.manualOverride)
        : Number(r.rate.rateToToman);
      rateToToman = Number.isFinite(rate) && rate > 0 ? rate : null;
      rateUpdatedAt = (
        r.rate.fetchedAt ?? r.rate.updatedAt
      )?.toISOString();
      rateSource = overrideActive ? 'manual' : r.rate.source;
    }

    return {
      code: r.code,
      nameFa: r.nameFa,
      symbol: r.symbol,
      decimals: r.decimals,
      isEnabled: r.isEnabled,
      sortOrder: r.sortOrder,
      rateToToman,
      rateUpdatedAt,
      rateSource,
    };
  }
}
