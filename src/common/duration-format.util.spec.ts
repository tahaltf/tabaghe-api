import { formatMinutesDurationFa } from './duration-format.util';

describe('formatMinutesDurationFa', () => {
  it('formats short admin test deadlines', () => {
    expect(formatMinutesDurationFa(2)).toBe('2 دقیقه');
  });

  it('formats hour-based deadlines', () => {
    expect(formatMinutesDurationFa(48 * 60)).toBe('48 ساعت');
  });
});
