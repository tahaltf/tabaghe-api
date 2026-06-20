import type { Request } from 'express';

export function extractClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0]?.split(',')[0]?.trim() || null;
  }
  return req.ip || req.socket?.remoteAddress || null;
}

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
