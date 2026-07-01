import Decimal from 'decimal.js';

export type ListingDirectPriceFields = {
  price: number | string | Decimal;
  compareAtPrice?: number | string | Decimal | null;
  salePrice?: number | string | Decimal | null;
};

export function resolveListingCompareAtPrice(
  direct: ListingDirectPriceFields,
): number | null {
  const sale = direct.salePrice != null ? Number(direct.salePrice) : null;
  if (sale == null || !Number.isFinite(sale) || sale <= 0) {
    return null;
  }
  const compare =
    direct.compareAtPrice != null
      ? Number(direct.compareAtPrice)
      : Number(direct.price);
  if (!Number.isFinite(compare) || compare <= sale) {
    return null;
  }
  return compare;
}

export function resolveListingEffectiveUnitPrice(
  direct: ListingDirectPriceFields,
): number {
  const base = Number(direct.price);
  const sale = direct.salePrice != null ? Number(direct.salePrice) : null;
  if (sale != null && Number.isFinite(sale) && sale > 0 && sale < base) {
    return sale;
  }
  return base;
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
    throw new Error('قیمت ویژه باید کمتر از قیمت اصلی باشد');
  }
}
