import type { ProductFeedMarkupType } from '../dto/admin-product-feed.dto';

export function applyPriceMarkup(
  amount: number,
  markupType: ProductFeedMarkupType | string,
  markupValue: number,
): number {
  const base = Number(amount);
  if (!Number.isFinite(base) || base < 0) return 0;
  const value = Number(markupValue);
  if (!Number.isFinite(value) || value < 0) return Math.round(base);

  if (markupType === 'PERCENT') {
    return Math.round(base * (1 + value / 100));
  }
  if (markupType === 'FIXED') {
    return Math.round(base + value);
  }
  return Math.round(base);
}

/** Strip page query so externalSiteUrl stays stable across paginated fetches. */
export function normalizeFeedBaseUrl(feedUrl: string): string {
  const url = new URL(feedUrl.trim());
  url.hash = '';
  url.searchParams.delete('page');
  url.searchParams.delete('page_num');
  url.searchParams.delete('p');
  const qs = url.searchParams.toString();
  return `${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`.replace(/\/+$/, '') ||
    url.origin;
}

export function buildFeedPageUrl(feedUrl: string, page: number): string {
  const url = new URL(feedUrl.trim());
  if (page <= 1) {
    url.searchParams.delete('page');
    url.searchParams.delete('page_num');
    return url.toString();
  }
  url.searchParams.set('page', String(page));
  return url.toString();
}
