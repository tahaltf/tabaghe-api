import type { RedisOptions } from 'ioredis';

const MAX_RETRY_DELAY_MS = 30_000;
const BASE_RETRY_DELAY_MS = 200;

/**
 * Shared ioredis options for RedisService and Socket.io adapter.
 * Retry/reconnect without crashing the Nest process on transient drops.
 */
export function createRedisConnectionOptions(): RedisOptions {
  return {
    enableReadyCheck: true,
    lazyConnect: false,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    retryStrategy(times: number): number | null {
      if (times > 50) {
        // Keep retrying forever with capped backoff — do not give up and crash.
        return MAX_RETRY_DELAY_MS;
      }
      const delay = Math.min(
        BASE_RETRY_DELAY_MS * 2 ** Math.min(times, 8),
        MAX_RETRY_DELAY_MS,
      );
      return delay;
    },
    reconnectOnError(err: Error): boolean | 1 | 2 {
      const msg = err.message || '';
      // READONLY / connection reset: force reconnect
      if (
        msg.includes('READONLY') ||
        msg.includes('ECONNRESET') ||
        msg.includes('ETIMEDOUT') ||
        msg.includes('ECONNREFUSED')
      ) {
        return 2; // reconnect and resend failed command
      }
      return false;
    },
  };
}

/**
 * Validate REDIS_URL format. Returns trimmed URL or null if unset.
 * Throws if set but invalid.
 */
export function parseRedisUrl(raw: string | undefined | null): string | null {
  const url = raw?.trim() ?? '';
  if (!url) return null;
  if (!/^rediss?:\/\//i.test(url)) {
    throw new Error(
      'REDIS_URL must start with redis:// or rediss:// (TLS)',
    );
  }
  try {
    // URL constructor validates host/port/auth shape
    // eslint-disable-next-line no-new
    new URL(url);
  } catch {
    throw new Error('REDIS_URL is not a valid URL');
  }
  return url;
}
