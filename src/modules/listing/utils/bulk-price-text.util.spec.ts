import {
  normalizeListingTitleKey,
  parseBulkPriceText,
  parsePriceAmount,
  toEnglishDigits,
} from './bulk-price-text.util';

describe('bulk-price-text.util', () => {
  it('converts Persian digits', () => {
    expect(toEnglishDigits('۸۵۰۰۰۰')).toBe('850000');
  });

  it('parses price with separators and تومان', () => {
    expect(parsePriceAmount('۸۵٬۰۰۰٬۰۰۰ تومان')).toBe(85_000_000);
    expect(parsePriceAmount('1200000')).toBe(1_200_000);
    expect(parsePriceAmount('0')).toBe(0);
    expect(parsePriceAmount('۰')).toBe(0);
  });

  it('parses title = price lines', () => {
    const result = parseBulkPriceText(`
# توضیح
آیفون ۱۳ = 85000000
سامسونگ A54: ۱٬۲۰۰٬۰۰۰
bad line
`);
    expect(result.items).toHaveLength(2);
    expect(result.items[0].query).toBe('آیفون ۱۳');
    expect(result.items[0].price).toBe(85_000_000);
    expect(result.items[1].price).toBe(1_200_000);
    expect(result.failures).toHaveLength(1);
  });

  it('normalizes title keys', () => {
    expect(normalizeListingTitleKey('  آيفون  ۱۳  ')).toBe(
      normalizeListingTitleKey('آیفون ۱۳'),
    );
  });
});
