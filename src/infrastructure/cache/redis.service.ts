import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';

/** Shared Redis client when REDIS_URL is set; otherwise null (in-process fallback). */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      return;
    }
    this.client = new Redis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    this.client.on('error', (err) => {
      this.logger.warn(`Redis error: ${err.message}`);
    });
    this.client.on('connect', () => {
      this.logger.log('Redis connected');
    });
  }

  onModuleInit(): void {
    if (!this.client) {
      this.logger.log('REDIS_URL not set — using in-process cache/throttle');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.quit().catch(() => undefined);
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
    if (!this.isEnabled()) return null;
    return this.client!.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (!this.isEnabled()) return;
    await this.client!.set(key, value, 'EX', Math.max(1, ttlSeconds));
  }

  async del(key: string): Promise<void> {
    if (!this.client) return;
    await this.client.del(key);
  }
}
