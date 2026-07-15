import type { Request } from 'express';
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

export function buildRedirectUrl(
  targetUrl: string,
  incomingQuery: Record<string, string>,
  frontendAppUrl: string,
): string {
  const base = (frontendAppUrl || 'https://tabagheh.com').replace(/\/+$/, '');
  let url: URL;

  if (/^https?:\/\//i.test(targetUrl)) {
    url = new URL(targetUrl);
  } else {
    const path = targetUrl.startsWith('/') ? targetUrl : `/${targetUrl}`;
    url = new URL(path, `${base}/`);
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
  return `${name}=${encodeURIComponent(linkId)}; Path=/; Max-Age=${maxAgeSec}; SameSite=Lax; HttpOnly`;
}
