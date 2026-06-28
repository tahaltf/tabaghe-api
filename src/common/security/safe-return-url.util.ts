import { buildCorsOrigins } from '../../config/cors-origins.util';

function collectAllowedReturnOrigins(): string[] {
  const frontendAppUrl = (
    process.env.FRONTEND_APP_URL || 'https://tabagheh.com'
  ).trim();
  return buildCorsOrigins(frontendAppUrl);
}

/** Resolves payment/auth return URLs against configured frontend origins. */
export function resolveSafeReturnUrl(
  candidate: string | null | undefined,
  fallbackUrl: string,
): URL {
  const fallback = new URL(fallbackUrl);
  const trimmed = String(candidate ?? '').trim();
  if (!trimmed) return fallback;

  try {
    const parsed = new URL(trimmed);
    const allowed = collectAllowedReturnOrigins();
    if (allowed.includes(parsed.origin)) {
      return parsed;
    }
  } catch {
    // fall through
  }

  return fallback;
}

export function isSafeRelativeReturnPath(path: string | null | undefined): boolean {
  const trimmed = String(path ?? '').trim();
  if (!trimmed.startsWith('/')) return false;
  if (trimmed.startsWith('//')) return false;
  if (trimmed.includes('://')) return false;
  return true;
}
