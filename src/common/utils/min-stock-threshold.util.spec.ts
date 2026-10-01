import {
  applyMinStockThreshold,
  isDueForSync,
  normalizeMinStockForAvailable,
} from './min-stock-threshold.util';

describe('min-stock-threshold.util', () => {
  describe('normalizeMinStockForAvailable', () => {
    it('defaults to 1', () => {
      expect(normalizeMinStockForAvailable(undefined)).toBe(1);
      expect(normalizeMinStockForAvailable(null)).toBe(1);
    });

    it('floors and clamps to at least 1', () => {
      expect(normalizeMinStockForAvailable(2.9)).toBe(2);
      expect(normalizeMinStockForAvailable(0)).toBe(1);
      expect(normalizeMinStockForAvailable(-3)).toBe(1);
    });
  });

  describe('applyMinStockThreshold', () => {
    it('keeps stock when at or above threshold', () => {
      expect(applyMinStockThreshold(2, 2)).toBe(2);
      expect(applyMinStockThreshold(5, 2)).toBe(5);
    });

    it('returns 0 when below threshold', () => {
      expect(applyMinStockThreshold(1, 2)).toBe(0);
      expect(applyMinStockThreshold(0, 1)).toBe(0);
    });
  });

  describe('isDueForSync', () => {
    const now = new Date('2026-10-01T12:00:00.000Z');

    it('is due when never synced', () => {
      expect(isDueForSync(null, 15, now)).toBe(true);
    });

    it('is not due before interval elapses', () => {
      const last = new Date('2026-10-01T11:50:00.000Z');
      expect(isDueForSync(last, 15, now)).toBe(false);
    });

    it('is due after interval elapses', () => {
      const last = new Date('2026-10-01T11:40:00.000Z');
      expect(isDueForSync(last, 15, now)).toBe(true);
    });
  });
});
