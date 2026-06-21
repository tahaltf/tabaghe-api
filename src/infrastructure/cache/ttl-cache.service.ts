import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

/**
 * TTL cache: Redis when REDIS_URL is ready, otherwise in-process Map.
 */
@Injectable()
export class TtlCacheService {
  private readonly store = new Map<string, CacheEntry>();

  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    if (this.redis.isEnabled()) {
      const raw = await this.redis.get(`cache:${key}`);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    const row = this.store.get(key);
    if (!row) return null;
    if (Date.now() > row.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return row.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.set(`cache:${key}`, JSON.stringify(value), ttlSeconds);
      return;
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<void> {
    if (this.redis.isEnabled()) {
      await this.redis.del(`cache:${key}`);
    }
    this.store.delete(key);
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
