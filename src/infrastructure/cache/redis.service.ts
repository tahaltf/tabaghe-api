import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import {
  createRedisConnectionOptions,
  parseRedisUrl,
} from './redis-options.util';

/**
 * Shared Redis client when REDIS_URL is set; otherwise null (in-process fallback).
 * All set() calls require a TTL to prevent unbounded memory growth.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor() {
    let url: string | null = null;
    try {
      url = parseRedisUrl(process.env.REDIS_URL);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Invalid REDIS_URL: ${message}`);
      throw err;
    }

    if (!url) {
      return;
    }

    this.client = new Redis(url, createRedisConnectionOptions());
    this.wireClientEvents(this.client);
  }

  private wireClientEvents(client: Redis): void {
    client.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
    client.on('connect', () => {
      this.logger.log('Redis TCP connected');
    });
    client.on('ready', () => {
      this.logger.log('Redis ready');
    });
    client.on('close', () => {
      this.logger.warn('Redis connection closed');
    });
    client.on('reconnecting', (delay: number) => {
      this.logger.warn(`Redis reconnecting in ${delay}ms`);
    });
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.log('REDIS_URL not set — using in-process cache/throttle');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }

  isEnabled(): boolean {
    return this.client?.status === 'ready';
  }

  getClient(): Redis | null {
    return this.client;
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis GET failed (${key}): ${message}`);
      return null;
    }
  }

  /**
   * SET with mandatory TTL (seconds). Rejects missing/invalid TTL to avoid OOM.
   */
  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds < 1) {
      throw new Error(
        `Redis set() requires ttlSeconds >= 1 (got ${String(ttlSeconds)})`,
      );
    }
    if (!this.client) return;
    const ttl = Math.floor(ttlSeconds);
    try {
      await this.client.set(key, value, 'EX', ttl);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis SET failed (${key}): ${message}`);
    }
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Redis DEL failed (${key}): ${message}`);
    }
  }

  /**
   * Delete keys matching a pattern using SCAN (never KEYS).
   * Returns the number of keys removed.
   */
  async deleteByPattern(pattern: string): Promise<number> {
    if (!this.client) return 0;
    if (!pattern || pattern.includes('\0')) {
      throw new Error('Invalid Redis delete pattern');
    }

    let removed = 0;
    const stream = this.client.scanStream({
      match: pattern,
      count: 100,
    });

    const batch: string[] = [];
    const flush = async () => {
      if (!batch.length || !this.client) return;
      const keys = batch.splice(0, batch.length);
      try {
        removed += await this.client.unlink(...keys);
      } catch {
        removed += await this.client.del(...keys);
      }
    };

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (keys: string[]) => {
        if (!Array.isArray(keys) || !keys.length) return;
        batch.push(...keys);
        if (batch.length >= 100) {
          stream.pause();
          void flush()
            .then(() => stream.resume())
            .catch(reject);
        }
      });
      stream.on('end', () => {
        void flush().then(resolve).catch(reject);
      });
      stream.on('error', reject);
    });

    return removed;
  }
}
