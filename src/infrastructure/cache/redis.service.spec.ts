import { parseRedisUrl } from './redis-options.util';
import { RedisService } from './redis.service';
import { TtlCacheService } from './ttl-cache.service';
import { buildRedisKey } from './redis-key.util';

describe('parseRedisUrl', () => {
  it('returns null for empty', () => {
    expect(parseRedisUrl(undefined)).toBeNull();
    expect(parseRedisUrl('')).toBeNull();
    expect(parseRedisUrl('   ')).toBeNull();
  });

  it('accepts redis:// and rediss://', () => {
    expect(parseRedisUrl('redis://localhost:6379')).toBe(
      'redis://localhost:6379',
    );
    expect(parseRedisUrl('rediss://user:pass@host:6380/0')).toContain(
      'rediss://',
    );
  });

  it('rejects invalid schemes', () => {
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow(/redis:\/\//);
  });
});

const redisUrl = process.env.REDIS_URL?.trim();
const describeRedis = redisUrl ? describe : describe.skip;

describeRedis('RedisService integration (requires REDIS_URL)', () => {
  let redis: RedisService;
  let cache: TtlCacheService;

  beforeAll(async () => {
    process.env.REDIS_URL = redisUrl!;
    redis = new RedisService();
    const deadline = Date.now() + 15_000;
    while (!redis.isEnabled() && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!redis.isEnabled()) {
      throw new Error('Redis did not become ready in time');
    }
    cache = new TtlCacheService(redis);
  });

  afterAll(async () => {
    await redis.onModuleDestroy();
  });

  it('requires TTL on set', async () => {
    await expect(redis.set('tabagheh:test:no-ttl', 'x', 0)).rejects.toThrow(
      /ttlSeconds/,
    );
    await expect(
      redis.set('tabagheh:test:no-ttl', 'x', Number.NaN),
    ).rejects.toThrow(/ttlSeconds/);
  });

  it('set / get / del with TTL', async () => {
    const key = buildRedisKey('test', 'smoke', String(Date.now()));
    await redis.set(key, 'hello', 30);
    expect(await redis.get(key)).toBe('hello');
    await redis.del(key);
    expect(await redis.get(key)).toBeNull();
  });

  it('deleteByPattern uses scanStream (never KEYS)', async () => {
    const stamp = String(Date.now());
    const k1 = buildRedisKey('test', 'pattern', stamp, 'a');
    const k2 = buildRedisKey('test', 'pattern', stamp, 'b');
    await redis.set(k1, '1', 60);
    await redis.set(k2, '2', 60);
    const removed = await redis.deleteByPattern(
      buildRedisKey('test', 'pattern', stamp) + ':*',
    );
    expect(removed).toBeGreaterThanOrEqual(2);
    expect(await redis.get(k1)).toBeNull();
    expect(await redis.get(k2)).toBeNull();
  });

  it('TtlCacheService namespaces keys under tabagheh:cache', async () => {
    const logical = `listings:home-feed:smoke-${Date.now()}`;
    await cache.set(logical, { ok: true }, 30);
    const full = cache.toRedisKey(logical);
    expect(full.startsWith('tabagheh:cache:listings:home-feed:')).toBe(true);
    expect(await cache.get<{ ok: boolean }>(logical)).toEqual({ ok: true });
    expect(await redis.get(full)).toContain('"ok":true');
    await cache.deleteByPrefix('listings:home-feed');
    expect(await cache.get(logical)).toBeNull();
  });

  it('exposes a client suitable for Throttler Redis storage', () => {
    const client = redis.getClient();
    expect(client).not.toBeNull();
    expect(client!.status).toBe('ready');
  });
});

describe('TtlCacheService in-process fallback', () => {
  it('stores and expires via Map when Redis is disabled', async () => {
    const previous = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const redis = new RedisService();
    expect(redis.isEnabled()).toBe(false);
    const cache = new TtlCacheService(redis);
    await cache.set('common:site-settings', { a: 1 }, 60);
    expect(await cache.get('common:site-settings')).toEqual({ a: 1 });
    await cache.deleteByPrefix('common');
    expect(await cache.get('common:site-settings')).toBeNull();
    await redis.onModuleDestroy();
    if (previous !== undefined) process.env.REDIS_URL = previous;
  });
});
