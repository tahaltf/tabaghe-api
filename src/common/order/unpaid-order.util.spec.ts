import {
  isListingSoldUnpaidCancelReason,
  isUnpaidOrderStatus,
  resolveDirectCancelKind,
} from './unpaid-order.util';
import { OrderStatus, OrderType } from '@prisma/client';

describe('unpaid-order.util', () => {
  it('detects unpaid statuses', () => {
    expect(isUnpaidOrderStatus(OrderStatus.PENDING)).toBe(true);
    expect(isUnpaidOrderStatus(OrderStatus.AWAITING_PAYMENT)).toBe(true);
    expect(isUnpaidOrderStatus(OrderStatus.PAID)).toBe(false);
  });

  it('detects listing sold cancel reason', () => {
    expect(isListingSoldUnpaidCancelReason('کالا فروش رفته؛ سفارش لغو شد')).toBe(true);
    expect(isListingSoldUnpaidCancelReason('لغو دستی')).toBe(false);
  });

  it('resolves direct cancel kind', () => {
    expect(
      resolveDirectCancelKind({
        status: OrderStatus.CANCELLED,
        type: OrderType.DIRECT,
        cancelReason: 'کالا فروش رفته؛ سفارش لغو شد',
      }),
    ).toBe('LISTING_SOLD');
  });
});
