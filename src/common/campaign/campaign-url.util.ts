export const DEFAULT_CAMPAIGN_URL_PREFIX = 'ref';

/** پیشوندهای قدیمی که همیشه فعال می‌مانند */
export const LEGACY_CAMPAIGN_URL_PREFIXES = new Set(['ref']);

export function normalizeCampaignUrlPrefix(raw?: string | null): string {
  const v = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (!v) return DEFAULT_CAMPAIGN_URL_PREFIX;
  if (!/^[a-z0-9-]+$/.test(v)) return DEFAULT_CAMPAIGN_URL_PREFIX;
  return v;
}

export function isAllowedCampaignPrefix(
  prefix: string,
  configuredPrefix = DEFAULT_CAMPAIGN_URL_PREFIX,
): boolean {
  const p = prefix.trim().toLowerCase();
  if (LEGACY_CAMPAIGN_URL_PREFIXES.has(p)) return true;
  return p === normalizeCampaignUrlPrefix(configuredPrefix);
}
