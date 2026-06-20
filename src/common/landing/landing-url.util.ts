export const DEFAULT_LANDING_URL_PREFIX = 'p';

export function normalizeLandingUrlPrefix(raw?: string | null): string {
  const v = String(raw ?? '')
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
  if (!v) return DEFAULT_LANDING_URL_PREFIX;
  if (!/^[a-z0-9-]+$/.test(v)) return DEFAULT_LANDING_URL_PREFIX;
  return v;
}
