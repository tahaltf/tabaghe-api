/** عنوان آگهی نباید با شناسهٔ listingId یکی باشد. */
export function isListingTitleLikelyId(
  listingTitle: unknown,
  listingId?: unknown,
): boolean {
  if (listingTitle == null) return false;
  const title = String(listingTitle).trim();
  if (!title) return false;
  if (listingId != null && title === String(listingId).trim()) return true;
  // cuid / cuid2 تقریبی
  return /^c[a-z0-9]{8,}$/i.test(title) && title.length >= 20 && title.length <= 36;
}

export function resolveListingTitleFromMeta(
  meta: Record<string, unknown> | undefined,
  fallback = 'یک آگهی',
): string {
  if (!meta) return fallback;
  const listingId = meta['listingId'];
  const raw = meta['listingTitle'];
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed && !isListingTitleLikelyId(trimmed, listingId)) {
      return trimmed;
    }
  }
  return fallback;
}

export function normalizeListingTitleInMeta(
  meta: Record<string, unknown>,
  resolvedTitle: string | null | undefined,
): void {
  const title = resolvedTitle?.trim();
  if (!title) return;
  const current = meta['listingTitle'];
  if (
    !current ||
    isListingTitleLikelyId(current, meta['listingId'])
  ) {
    meta['listingTitle'] = title;
  }
}
