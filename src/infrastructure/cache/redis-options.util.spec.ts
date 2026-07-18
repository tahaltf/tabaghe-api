import { parseRedisUrl } from './redis-options.util';

describe('parseRedisUrl (options util)', () => {
  it('trims and validates', () => {
    expect(parseRedisUrl('  redis://127.0.0.1:6379  ')).toBe(
      'redis://127.0.0.1:6379',
    );
  });
});
