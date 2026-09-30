import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { RedisService } from '../../infrastructure/cache/redis.service';

type MemoryBucket = { count: number; resetAt: number };

/**
 * سقف تعداد اکشن در یک بازه برای هر userId (Redis با fallback حافظه).
 */
@Injectable()
export class UserActionRateLimitService {
  private readonly memory = new Map<string, MemoryBucket>();

  constructor(private readonly redis: RedisService) {}

  async consumeOrThrow(
    userId: string,
    action: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    const key = `ual:${action}:${userId}`;
    const client = this.redis.getClient();

    if (client) {
      try {
        const count = await client.incr(key);
        if (count === 1) {
          await client.expire(key, Math.max(1, Math.floor(windowSeconds)));
        }
        if (count > limit) {
          throw this.tooMany();
        }
        return;
      } catch (err) {
        if (err instanceof HttpException) throw err;
        // Redis down → fall through to memory
      }
    }

    const now = Date.now();
    const windowMs = Math.max(1, windowSeconds) * 1000;
    let bucket = this.memory.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.memory.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      throw this.tooMany();
    }
  }

  private tooMany(): HttpException {
    return new HttpException(
      'تعداد درخواست‌های شما بیش از حد مجاز است. لطفاً کمی بعد دوباره تلاش کنید.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
