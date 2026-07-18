import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';
import {
  buildRedisKey,
  buildRedisPattern,
  splitLogicalCacheKey,
} from './redis-key.util';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * TTL cache: Redis when REDIS_URL is ready, otherwise in-process Map.
 * All keys are namespaced as `tabagheh:cache:...` via the key sanitizer.
 */
@Injectable()
export class TtlCacheService {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly redis: RedisService) {}

  /** Resolve logical key (e.g. `listings:home-feed:10`) to full Redis key. */
  toRedisKey(logicalKey: string): string {
    const parts = splitLogicalCacheKey(logicalKey);
    return buildRedisKey('cache', ...parts);
  }

  async get<T>(key: string): Promise<T | null> {
    const redisKey = this.toRedisKey(key);
    if (this.redis.isEnabled()) {
      const raw = await this.redis.get(redisKey);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    const row = this.store.get(redisKey);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.store.delete(redisKey);
      return null;
    }
    return row.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(
        `TtlCacheService.set() requires ttlSeconds >= 1 (got ${String(ttlSeconds)})`,
      );
    }
    const redisKey = this.toRedisKey(key);
    if (this.redis.isEnabled()) {
      await this.redis.set(redisKey, JSON.stringify(value), ttlSeconds);
      return;
    }
    this.store.set(redisKey, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    const redisKey = this.toRedisKey(key);
    if (this.redis.isEnabled()) {
      await this.redis.del(redisKey);
    }
    this.store.delete(redisKey);
  }

  /**
   * Invalidate all cache keys under a logical prefix using SCAN (never KEYS).
   * Example: `deleteByPrefix('common')` removes `tabagheh:cache:common:*`
   */
  async deleteByPrefix(logicalPrefix: string): Promise<number> {
    const parts = splitLogicalCacheKey(logicalPrefix);
    const pattern = buildRedisPattern('cache', ...parts, '*');

    let removed = 0;
    if (this.redis.isEnabled()) {
      removed = await this.redis.deleteByPattern(pattern);
    }

    const prefix = buildRedisKey('cache', ...parts) + ':';
    const exact = buildRedisKey('cache', ...parts);
    for (const k of [...this.store.keys()]) {
      if (k === exact || k.startsWith(prefix)) {
        this.store.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  async getOrSet<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
  ): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
