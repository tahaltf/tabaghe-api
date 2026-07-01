import {
  resolveListingCompareAtPrice,
  validateListingSalePricing,
} from './listing-price.util';

describe('resolveListingCompareAtPrice', () => {
  it('returns base price when sale is active', () => {
    expect(
      resolveListingCompareAtPrice({
        price: 1_000_000,
        compareAtPrice: 1_200_000,
        salePrice: 850_000,
      }),
    ).toBe(1_000_000);
  });
});

describe('validateListingSalePricing', () => {
  it('accepts sale price lower than base price', () => {
    expect(() =>
      validateListingSalePricing({
        price: 1_000_000,
        salePrice: 800_000,
      }),
    ).not.toThrow();
  });

  it('rejects sale price greater than base price', () => {
    expect(() =>
      validateListingSalePricing({
        price: 1_000_000,
        salePrice: 1_200_000,
      }),
    ).toThrow('قیمت تخفیف نمی‌تواند بیشتر از قیمت اصلی باشد');
  });

  it('rejects sale price equal to base price', () => {
    expect(() =>
      validateListingSalePricing({
        price: 1_000_000,
        salePrice: 1_000_000,
      }),
    ).toThrow('قیمت تخفیف نمی‌تواند بیشتر از قیمت اصلی باشد');
  });

  it('skips validation when salePrice is null', () => {
    expect(() =>
      validateListingSalePricing({
        price: 1_000_000,
        salePrice: null,
      }),
    ).not.toThrow();
  });
});
