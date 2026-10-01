export const PRODUCT_FEED_SYNC_INTERVAL_MINUTES = [
  15, 30, 60, 180, 360, 720, 1440,
] as const;

export type ProductFeedSyncIntervalMinutes =
  (typeof PRODUCT_FEED_SYNC_INTERVAL_MINUTES)[number];

export const WORDPRESS_SYNC_INTERVAL_HOURS = [0, 6, 12, 24] as const;

export type WordPressSyncIntervalHours =
  (typeof WORDPRESS_SYNC_INTERVAL_HOURS)[number];

export function normalizeMinStockForAvailable(
  value: number | null | undefined,
  fallback = 1,
): number {
  const n = value == null ? fallback : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

/**
 * موجودی قابل فروش روی سایت پس از اعمال آستانه.
 * اگر موجودی منبع کمتر از آستانه باشد → 0 (ناموجود روی سایت، بدون آرشیو).
 */
export function applyMinStockThreshold(
  sourceStock: number,
  minStockForAvailable: number,
): number {
  const stock = Math.max(0, Math.floor(Number(sourceStock) || 0));
  const min = normalizeMinStockForAvailable(minStockForAvailable);
  return stock >= min ? stock : 0;
}

export function isDueForSync(
  lastSyncAt: Date | null | undefined,
  intervalMinutes: number,
  now = new Date(),
): boolean {
  if (!lastSyncAt) return true;
  const intervalMs = Math.max(1, Math.floor(intervalMinutes)) * 60_000;
  return now.getTime() - lastSyncAt.getTime() >= intervalMs;
}
