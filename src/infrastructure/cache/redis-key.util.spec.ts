import {
  buildRedisKey,
  buildRedisPattern,
  REDIS_APP_PREFIX,
  sanitizeRedisKeyPart,
  splitLogicalCacheKey,
} from './redis-key.util';

describe('redis-key.util', () => {
  describe('sanitizeRedisKeyPart', () => {
    it('keeps safe alphanumeric and separators', () => {
      expect(sanitizeRedisKeyPart('user_verified-1')).toBe('user_verified-1');
      expect(sanitizeRedisKeyPart('a:b:c')).toBe('a:b:c');
    });

    it('strips glob and injection characters', () => {
      expect(sanitizeRedisKeyPart('foo*bar?[x]\\')).toBe('foobarx');
      expect(sanitizeRedisKeyPart('a\nb\0c')).toBe('abc');
      expect(sanitizeRedisKeyPart('hello world')).toBe('hello_world');
    });

    it('rejects empty after sanitization', () => {
      expect(() => sanitizeRedisKeyPart('***')).toThrow();
      expect(() => sanitizeRedisKeyPart('   ')).toThrow();
    });

    it('truncates long parts', () => {
      const long = 'a'.repeat(200);
      expect(sanitizeRedisKeyPart(long).length).toBe(128);
    });
  });

  describe('buildRedisKey', () => {
    it('prefixes with tabagheh and domain', () => {
      expect(buildRedisKey('cache', 'listings', 'home-feed', 10)).toBe(
        `${REDIS_APP_PREFIX}:cache:listings:home-feed:10`,
      );
    });

    it('sanitizes dynamic parts', () => {
      expect(buildRedisKey('cache', 'user', 'evil*key')).toBe(
        `${REDIS_APP_PREFIX}:cache:user:evilkey`,
      );
    });
  });

  describe('buildRedisPattern', () => {
    it('allows controlled trailing wildcard', () => {
      expect(buildRedisPattern('cache', 'common', '*')).toBe(
        `${REDIS_APP_PREFIX}:cache:common:*`,
      );
    });
  });

  describe('splitLogicalCacheKey', () => {
    it('splits colon-separated logical keys', () => {
      expect(splitLogicalCacheKey('listings:home-feed:10')).toEqual([
        'listings',
        'home-feed',
        '10',
      ]);
    });
  });
});
