import {
  isListingTitleLikelyId,
  normalizeListingTitleInMeta,
  resolveListingTitleFromMeta,
} from './listing-title-meta.util';

describe('listing-title-meta.util', () => {
  it('detects when listingTitle equals listingId', () => {
    const id = 'clxyz123456789abcdefghij';
    expect(isListingTitleLikelyId(id, id)).toBe(true);
  });

  it('keeps real Persian titles', () => {
    expect(isListingTitleLikelyId('گوشی آیفون ۱۳', 'clxyz123')).toBe(false);
  });

  it('resolveListingTitleFromMeta ignores id-like title', () => {
    const id = 'clxyz123456789abcdefghij';
    expect(
      resolveListingTitleFromMeta(
        { listingTitle: id, listingId: id },
        'fallback',
      ),
    ).toBe('fallback');
  });

  it('normalizeListingTitleInMeta overwrites id-like title', () => {
    const id = 'clxyz123456789abcdefghij';
    const meta: Record<string, unknown> = {
      listingId: id,
      listingTitle: id,
    };
    normalizeListingTitleInMeta(meta, 'لپ‌تاپ Dell');
    expect(meta.listingTitle).toBe('لپ‌تاپ Dell');
  });
});
