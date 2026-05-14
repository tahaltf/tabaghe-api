import type { Request } from 'express';

export type ClientNetworkDetectionSource =
  | 'cf-ipcountry'
  | 'x-vercel-ip-country'
  | 'x-tabaghe-client-country';

export interface ClientNetworkHintDto {
  /** کد دوحرفی ISO (مثلاً IR، DE)؛ اگر از هدر قابل استخراج نباشد null */
  countryCode: string | null;
  /** منبع هدر استفاده‌شده؛ برای دیباگ و nginx */
  detectionSource: ClientNetworkDetectionSource | null;
  /**
   * فقط وقتی true که کشور از هدر قطعی باشد و غیر ایران باشد.
   * بدون هدر (مثلاً لوکال یا پروکسی بدون CF) همیشه false تا کاربر اذیت نشود.
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

/**
 * تشخیص کشور از هدرهای لبهٔ شبکه (بدون تماس به APIهای Geo خارجی).
 * در nginx می‌توان با geoip2 هدر X-Tabaghe-Client-Country را ست کرد.
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
