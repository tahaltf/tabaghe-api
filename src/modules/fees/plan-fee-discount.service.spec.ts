import Decimal from 'decimal.js';
import {
  PlanFeeDiscountService,
  type SellerDiscountInfo,
} from './plan-fee-discount.service';

describe('PlanFeeDiscountService.applyDiscountAndBounds', () => {
  const service = new PlanFeeDiscountService(null as never);

  const info = (
    partial: Partial<SellerDiscountInfo> = {},
  ): SellerDiscountInfo => ({
    discountPercent: 0,
    feeFloor: new Decimal(0),
    feeCap: new Decimal(0),
    planTitle: null,
    planId: null,
    expiresAt: null,
    ...partial,
  });

  it('applies percent discount then floors', () => {
    const fee = service.applyDiscountAndBounds(
      new Decimal(100_000),
      info({ discountPercent: 20 }),
    );
    expect(fee.toNumber()).toBe(80_000);
  });

  it('raises fee to plan floor after discount', () => {
    const fee = service.applyDiscountAndBounds(
      new Decimal(100_000),
      info({
        discountPercent: 50,
        feeFloor: new Decimal(60_000),
      }),
    );
    expect(fee.toNumber()).toBe(60_000);
  });

  it('caps fee to plan ceiling after discount', () => {
    const fee = service.applyDiscountAndBounds(
      new Decimal(100_000),
      info({
        discountPercent: 0,
        feeCap: new Decimal(40_000),
      }),
    );
    expect(fee.toNumber()).toBe(40_000);
  });

  it('applies floor then cap when both set', () => {
    const fee = service.applyDiscountAndBounds(
      new Decimal(10_000),
      info({
        discountPercent: 0,
        feeFloor: new Decimal(20_000),
        feeCap: new Decimal(50_000),
      }),
    );
    expect(fee.toNumber()).toBe(20_000);
  });
});
