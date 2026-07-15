import type { Request } from 'express';

/** استخراج IP کلاینت با احترام به پروکسی (X-Forwarded-For / X-Real-IP) */
export function extractClientIp(req: Request): string | null {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded.length) {
    return forwarded[0]?.split(',')[0]?.trim() || null;
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }
  if (Array.isArray(realIp) && realIp.length) {
    return realIp[0]?.trim() || null;
  }

  return req.ip || req.socket?.remoteAddress || null;
}

export function extractUserAgent(req: Request): string | null {
  const ua = req.headers['user-agent'];
  if (typeof ua === 'string' && ua.trim()) {
    return ua.trim().slice(0, 512);
  }
  if (Array.isArray(ua) && ua[0]) {
    return String(ua[0]).trim().slice(0, 512);
  }
  return null;
}

export type ClientRequestMeta = {
  ipAddress: string | null;
  userAgent: string | null;
};

export function extractClientRequestMeta(req: Request): ClientRequestMeta {
  return {
    ipAddress: extractClientIp(req),
    userAgent: extractUserAgent(req),
  };
}
