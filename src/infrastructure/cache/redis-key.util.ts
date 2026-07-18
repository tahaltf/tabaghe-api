/** Fixed application prefix for all Redis keys. */
export const REDIS_APP_PREFIX = 'tabagheh';

const MAX_PART_LENGTH = 128;
const SAFE_PART_RE = /[^a-zA-Z0-9:_-]+/g;

/**
 * Sanitize a dynamic segment before it becomes part of a Redis key.
 * Strips control chars, glob metacharacters, and other injection vectors.
 */
export function sanitizeRedisKeyPart(input: unknown): string {
  const raw = String(input ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/[*?[\]\\]/g, '')
    .trim();

  const cleaned = raw.replace(SAFE_PART_RE, '_').replace(/_+/g, '_');
  if (!cleaned) {
    throw new Error('Redis key part is empty after sanitization');
  }
  return cleaned.slice(0, MAX_PART_LENGTH);
}

/**
 * Build a namespaced key: `tabagheh:{domain}:{part...}`
 */
export function buildRedisKey(
  domain: string,
  ...parts: Array<string | number>
): string {
  const safeDomain = sanitizeRedisKeyPart(domain);
  if (!safeDomain) {
    throw new Error('Redis key domain is required');
  }
  const safeParts = parts.map((p) => sanitizeRedisKeyPart(p));
  return [REDIS_APP_PREFIX, safeDomain, ...safeParts].join(':');
}

/**
 * Build a SCAN-safe pattern under a domain.
 * Only a trailing `*` (or mid-segment wildcards passed explicitly as the
 * string `*`) are allowed — never from unsanitized user input.
 */
export function buildRedisPattern(
  domain: string,
  ...parts: Array<string | number | '*'>
): string {
  const safeDomain = sanitizeRedisKeyPart(domain);
  if (!safeDomain) {
    throw new Error('Redis pattern domain is required');
  }
  const segments = parts.map((p) => {
    if (p === '*') return '*';
    return sanitizeRedisKeyPart(p);
  });
  return [REDIS_APP_PREFIX, safeDomain, ...segments].join(':');
}

/**
 * Split a logical cache key like `listings:home-feed:10` into sanitized parts
 * for `buildRedisKey('cache', ...)`.
 */
export function splitLogicalCacheKey(logicalKey: string): string[] {
  return logicalKey
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => sanitizeRedisKeyPart(s));
}
