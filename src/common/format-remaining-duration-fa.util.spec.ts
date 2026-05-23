import {
  formatLessThanRemainingFa,
  formatRemainingDurationFa,
} from './format-remaining-duration-fa.util';

describe('formatRemainingDurationFa', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatRemainingDurationFa(2 * 60 * 1000)).toBe('2 دقیقه');
    expect(formatRemainingDurationFa(2 * 60 * 60 * 1000)).toBe('2 ساعت');
    expect(
      formatRemainingDurationFa(1 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000),
    ).toBe('1 روز و 3 ساعت');
  });

  it('formatLessThanRemainingFa prefixes کمتر از', () => {
    expect(formatLessThanRemainingFa(5 * 60 * 1000)).toBe('کمتر از 5 دقیقه');
  });
});
