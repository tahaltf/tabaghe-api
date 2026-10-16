import type { Request } from 'express';
import { buildCorsOrigins } from '../../config/cors-origins.util';
export {
  extractClientIp,
  extractUserAgent,
  extractClientRequestMeta,
  type ClientRequestMeta,
} from '../../common/http/client-ip.util';

export function normalizeQueryParams(
  query: Request['query'],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length) out[key] = String(value[0]);
      continue;
    }
    out[key] = String(value);
  }
  return out;
}

function isAllowedCampaignTarget(url: URL, frontendAppUrl: string): boolean {
  const allowed = new Set(buildCorsOrigins(frontendAppUrl));
  return allowed.has(url.origin);
}

/** Normalize/validate campaign target URLs (same-site absolute or safe relative). */
export function normalizeCampaignTargetUrl(
  targetUrl: string,
  frontendAppUrl?: string,
): string {
  const base = (
    frontendAppUrl ||
    process.env.FRONTEND_APP_URL ||
    'https://tabagheh.com'
  ).replace(/\/+$/, '');
  const trimmed = String(targetUrl ?? '').trim();
  if (!trimmed) {
    throw new Error('targetUrl is required');
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const url = new URL(trimmed);
    if (!isAllowedCampaignTarget(url, base)) {
      throw new Error('targetUrl origin is not allowed');
    }
    return url.toString();
  }
  if (
    !trimmed.startsWith('/') ||
    trimmed.startsWith('//') ||
    trimmed.includes('://')
  ) {
    throw new Error('targetUrl must be a relative path or allowed absolute URL');
  }
  return trimmed;
}

export function buildRedirectUrl(
  targetUrl: string,
  incomingQuery: Record<string, string>,
  frontendAppUrl: string,
): string {
  const base = (frontendAppUrl || 'https://tabagheh.com').replace(/\/+$/, '');
  let url: URL;

  if (/^https?:\/\//i.test(targetUrl)) {
    url = new URL(targetUrl);
    if (!isAllowedCampaignTarget(url, frontendAppUrl)) {
      url = new URL('/', `${base}/`);
    }
  } else {
    const trimmed = targetUrl.trim();
    if (
      !trimmed.startsWith('/') ||
      trimmed.startsWith('//') ||
      trimmed.includes('://')
    ) {
      url = new URL('/', `${base}/`);
    } else {
      url = new URL(trimmed, `${base}/`);
    }
  }

  for (const [key, value] of Object.entries(incomingQuery)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
}

export interface SplitVariant {
  id: string;
  targetUrl: string;
  splitWeight: number;
}

/** Cookie name for sticky A/B assignment */
export function abSplitCookieName(splitGroup: string): string {
  return `tabaghe_ab_${splitGroup.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** Pick variant by weight; optional stickyId skips random when still valid. */
export function pickSplitVariant(
  variants: SplitVariant[],
  stickyId?: string | null,
): SplitVariant {
  if (!variants.length) {
    throw new Error('pickSplitVariant: empty variants');
  }
  if (stickyId) {
    const sticky = variants.find((v) => v.id === stickyId);
    if (sticky) return sticky;
  }
  const total = variants.reduce((sum, v) => sum + Math.max(0, v.splitWeight), 0);
  if (total <= 0) return variants[0]!;
  let roll = Math.random() * total;
  for (const v of variants) {
    roll -= Math.max(0, v.splitWeight);
    if (roll <= 0) return v;
  }
  return variants[variants.length - 1]!;
}

export function parseAbCookie(cookieHeader: string | undefined, splitGroup: string): string | null {
  if (!cookieHeader?.trim()) return null;
  const name = abSplitCookieName(splitGroup);
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function buildAbSetCookie(splitGroup: string, linkId: string, maxAgeSec = 60 * 60 * 24 * 30): string {
  const name = abSplitCookieName(splitGroup);
  const secure =
    process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(linkId)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax; HttpOnly${secure}`;
}
