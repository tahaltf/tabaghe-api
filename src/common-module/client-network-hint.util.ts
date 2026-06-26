import type { Request } from 'express';
import * as geoip from 'geoip-lite';
import { extractClientIp } from '../modules/tracking/tracking.util';

export type ClientNetworkDetectionSource =
  | 'cf-ipcountry'
  | 'x-vercel-ip-country'
  | 'x-tabaghe-client-country'
  | 'geoip-lite';

export interface ClientNetworkHintDto {
  /** کد دوحرفی ISO (مثلاً IR، DE)؛ اگر از هدر قابل استخراج نباشد null */
  countryCode: string | null;
  /** منبع هدر استفاده‌شده؛ برای دیباگ و nginx */
  detectionSource: ClientNetworkDetectionSource | null;
  /**
   * فقط وقتی true که کشور قطعی باشد و غیر ایران باشد.
   * بدون هدر و بدون IP عمومی قابل تشخیص، false تا کاربر اذیت نشود.
   */
  suggestNonIranConnection: boolean;
}

function readCountryHeader(
  headers: Request['headers'],
  name: string,
): string | null {
  const raw = headers[name];
  if (!raw) return null;
  const v = Array.isArray(raw) ? raw[0] : raw;
  const c = String(v).trim().toUpperCase();
  // Cloudflare: XX = ناشناخته
  if (!c || c === 'XX') return null;
  if (!/^[A-Z]{2}$/.test(c)) return null;
  return c;
}

function normalizeIp(ip: string): string {
  let s = ip.trim();
  if (s.startsWith('::ffff:')) {
    s = s.slice(7);
  }
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1);
  }
  return s;
}

function isPrivateOrLocalIp(ip: string): boolean {
  if (!ip || ip === '::1' || ip === '127.0.0.1' || ip === 'localhost') {
    return true;
  }
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) {
    return true;
  }
  const private172 = /^172\.(\d+)\./.exec(ip);
  if (private172) {
    const second = Number(private172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  if (ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe80:')) {
    return true;
  }
  return false;
}

function lookupCountryFromIp(ip: string | null): string | null {
  if (!ip) return null;
  const normalized = normalizeIp(ip);
  if (!normalized || isPrivateOrLocalIp(normalized)) return null;

  const geo = geoip.lookup(normalized);
  const country = geo?.country?.trim().toUpperCase();
  if (!country || country === 'XX' || !/^[A-Z]{2}$/.test(country)) {
    return null;
  }
  return country;
}

/**
 * تشخیص کشور از هدرهای لبهٔ شبکه (بدون تماس به APIهای Geo خارجی).
 * در nginx می‌توان با geoip2 هدر X-Tabaghe-Client-Country را ست کرد.
 * اگر هدر نبود، از IP واقعی کاربر با geoip-lite استفاده می‌شود.
 */
export function buildClientNetworkHint(req: Request): ClientNetworkHintDto {
  const h = req.headers;

  const fromCf = readCountryHeader(h, 'cf-ipcountry');
  if (fromCf) {
    return finalize(fromCf, 'cf-ipcountry');
  }

  const fromVercel = readCountryHeader(h, 'x-vercel-ip-country');
  if (fromVercel) {
    return finalize(fromVercel, 'x-vercel-ip-country');
  }

  const fromCustom = readCountryHeader(h, 'x-tabaghe-client-country');
  if (fromCustom) {
    return finalize(fromCustom, 'x-tabaghe-client-country');
  }

  const fromIp = lookupCountryFromIp(extractClientIp(req));
  if (fromIp) {
    return finalize(fromIp, 'geoip-lite');
  }

  return {
    countryCode: null,
    detectionSource: null,
    suggestNonIranConnection: false,
  };
}

function finalize(
  countryCode: string,
  source: ClientNetworkDetectionSource,
): ClientNetworkHintDto {
  const iran = countryCode === 'IR';
  return {
    countryCode,
    detectionSource: source,
    suggestNonIranConnection: !iran,
  };
}
