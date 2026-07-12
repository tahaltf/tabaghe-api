import {
  searchDigitVariants,
  toLatinDigits,
  toPersianDigits,
} from './search-digit-variants.util';

describe('searchDigitVariants', () => {
  it('converts Persian digits to Latin', () => {
    expect(toLatinDigits('FUN۶۰')).toBe('FUN60');
  });

  it('converts Latin digits to Persian', () => {
    expect(toPersianDigits('FUN60')).toBe('FUN۶۰');
  });

  it('returns unique latin and persian variants', () => {
    expect(searchDigitVariants('FUN۶۰')).toEqual(['FUN۶۰', 'FUN60']);
    expect(searchDigitVariants('FUN60')).toEqual(['FUN60', 'FUN۶۰']);
  });

  it('returns empty for blank input', () => {
    expect(searchDigitVariants('  ')).toEqual([]);
  });
});
