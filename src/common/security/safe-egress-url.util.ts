import { lookup } from 'dns/promises';
import { isIP } from 'net';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata',
]);

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return -1;
  }
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
}

function isPrivateOrReservedIp(ip: string): boolean {
  const v4 = isIP(ip) === 4 ? ip : null;
  const v6 = isIP(ip) === 6 ? ip : null;

  if (v4) {
    const n = ipv4ToInt(v4);
    if (n < 0) return true;
    // 0.0.0.0/8, 10/8, 127/8, 169.254/16, 172.16/12, 192.168/16, 100.64/10, 224+/4
    if (n <= 0x00ffffff) return true;
    if (n >= 0x0a000000 && n <= 0x0affffff) return true;
    if (n >= 0x7f000000 && n <= 0x7fffffff) return true;
    if (n >= 0xa9fe0000 && n <= 0xa9feffff) return true;
    if (n >= 0xac100000 && n <= 0xac1fffff) return true;
    if (n >= 0xc0a80000 && n <= 0xc0a8ffff) return true;
    if (n >= 0x64400000 && n <= 0x647fffff) return true;
    if (n >= 0xe0000000) return true;
    return false;
  }

  if (v6) {
    const lower = v6.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
    if (lower.startsWith('fe80')) return true; // link-local
    if (lower.startsWith('ff')) return true; // multicast
    // IPv4-mapped
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return isPrivateOrReservedIp(mapped);
    }
    return false;
  }

  return true;
}

export type SafeEgressOptions = {
  /** Default true — only https allowed for remote seller/feed URLs. */
  httpsOnly?: boolean;
  /** Allow http for local non-production debugging. */
  allowHttpInNonProduction?: boolean;
};

/**
 * Validate that a URL is safe for server-side fetch (SSRF guard).
 * Resolves DNS and rejects private/link-local/metadata targets.
 */
export async function assertSafeEgressUrl(
  rawUrl: string,
  options: SafeEgressOptions = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL');
  }

  const httpsOnly = options.httpsOnly !== false;
  const allowHttp =
    options.allowHttpInNonProduction === true &&
    process.env.NODE_ENV !== 'production';

  if (parsed.protocol === 'https:') {
    // ok
  } else if (parsed.protocol === 'http:' && (!httpsOnly || allowHttp)) {
    // ok
  } else {
    throw new Error('Only https URLs are allowed');
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!hostname || BLOCKED_HOSTNAMES.has(hostname)) {
    throw new Error('Blocked hostname');
  }
  if (hostname.endsWith('.local') || hostname.endsWith('.internal')) {
    throw new Error('Blocked hostname');
  }

  if (isIP(hostname)) {
    if (isPrivateOrReservedIp(hostname)) {
      throw new Error('Private IP addresses are not allowed');
    }
    return parsed;
  }

  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length) {
    throw new Error('DNS resolution failed');
  }
  for (const record of records) {
    if (isPrivateOrReservedIp(record.address)) {
      throw new Error('Resolved to a private IP address');
    }
  }

  return parsed;
}

/**
 * fetch() wrapper that validates the URL (and each redirect target) against SSRF rules.
 */
export async function safeEgressFetch(
  rawUrl: string,
  init: RequestInit = {},
  options: SafeEgressOptions = {},
): Promise<Response> {
  const maxRedirects = 3;
  let current = await assertSafeEgressUrl(rawUrl, options);
  let redirects = 0;

  // Drop caller redirect preference; we validate each hop.
  const { redirect: _ignored, ...rest } = init;

  while (true) {
    const response = await fetch(current.toString(), {
      ...rest,
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirects >= maxRedirects) {
        throw new Error('Unsafe or excessive redirect');
      }
      redirects += 1;
      current = await assertSafeEgressUrl(
        new URL(location, current).toString(),
        options,
      );
      continue;
    }

    return response;
  }
}
