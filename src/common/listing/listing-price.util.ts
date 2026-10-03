import Decimal from 'decimal.js';

export type ListingDirectPriceFields = {
  price: number | string | Decimal;
  compareAtPrice?: number | string | Decimal | null;
  salePrice?: number | string | Decimal | null;
};

export const BASE_LISTING_CURRENCY = 'IRT';

export function resolveListingCompareAtPrice(
  direct: ListingDirectPriceFields,
): number | null {
  const sale = direct.salePrice != null ? Number(direct.salePrice) : null;
  if (sale == null || !Number.isFinite(sale) || sale <= 0) {
    return null;
  }

  const fromCompareAt =
    direct.compareAtPrice != null ? Number(direct.compareAtPrice) : null;
  if (
    fromCompareAt != null &&
    Number.isFinite(fromCompareAt) &&
    fromCompareAt > sale
  ) {
    return fromCompareAt;
  }

  const fromPrice = Number(direct.price);
  if (Number.isFinite(fromPrice) && fromPrice > sale) {
    return fromPrice;
  }

  return null;
}

/** مبلغ مؤثر واحد به ارز خود آگهی (بدون تبدیل) */
export function resolveListingEffectiveUnitPrice(
  direct: ListingDirectPriceFields,
): number {
  const base = Number(direct.price);
  const sale = direct.salePrice != null ? Number(direct.salePrice) : null;
  if (sale == null || !Number.isFinite(sale) || sale <= 0) {
    return base;
  }
  if (sale < base) {
    return sale;
  }
  const compare = resolveListingCompareAtPrice(direct);
  if (compare != null && sale < compare) {
    return sale;
  }
  return base;
}

/**
 * مبلغ مؤثر به تومان.
 * اگر rateToToman داده نشود و ارز IRT باشد همان مبلغ؛ وگرنه amount * rate.
 */
export function resolveListingEffectiveUnitPriceToman(
  direct: ListingDirectPriceFields,
  options?: {
    priceCurrencyCode?: string | null;
    rateToToman?: number | null;
    /** اگر از قبل کش شده باشد اولویت دارد */
    priceTomanCached?: number | string | Decimal | null;
  },
): number {
  const cached =
    options?.priceTomanCached != null
      ? Number(options.priceTomanCached)
      : null;
  if (cached != null && Number.isFinite(cached) && cached > 0) {
    return Math.round(cached);
  }

  const foreign = resolveListingEffectiveUnitPrice(direct);
  const code = (options?.priceCurrencyCode ?? BASE_LISTING_CURRENCY)
    .trim()
    .toUpperCase();
  if (!code || code === BASE_LISTING_CURRENCY) {
    return Math.round(foreign);
  }
  const rate = options?.rateToToman != null ? Number(options.rateToToman) : null;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) {
    return Math.round(foreign);
  }
  // معادل تومان ارز خارجی → نزدیک‌ترین هزار تومان رو به بالا
  return Math.ceil((foreign * rate) / 1000) * 1000;
}

export function isListingOnSale(direct: ListingDirectPriceFields): boolean {
  return resolveListingCompareAtPrice(direct) != null;
}

export function validateListingSalePricing(direct: {
  price?: number | null;
  compareAtPrice?: number | null;
  salePrice?: number | null;
}): void {
  const price = Number(direct.price ?? 0);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error('قیمت اصلی باید بزرگ‌تر از صفر باشد');
  }
  const sale = direct.salePrice != null ? Number(direct.salePrice) : null;
  if (sale == null) return;
  if (!Number.isFinite(sale) || sale <= 0) {
    throw new Error('قیمت ویژه نامعتبر است');
  }
  const compare =
    direct.compareAtPrice != null ? Number(direct.compareAtPrice) : price;
  if (!Number.isFinite(compare) || compare <= sale) {
    throw new Error('قیمت تخفیف نمی‌تواند بیشتر از قیمت اصلی باشد');
  }
}
