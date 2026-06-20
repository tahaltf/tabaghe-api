import { isOrderStatusNotificationEnabled } from './notification-order-status-filter.util';

describe('isOrderStatusNotificationEnabled', () => {
  it('allows all statuses when filter is missing', () => {
    expect(isOrderStatusNotificationEnabled(null, { status: 'PAID' })).toBe(true);
    expect(isOrderStatusNotificationEnabled({}, { status: 'CANCELLED' })).toBe(true);
  });

  it('blocks all statuses when filter is empty array', () => {
    expect(
      isOrderStatusNotificationEnabled({ enabledOrderStatuses: [] }, { status: 'PAID' }),
    ).toBe(false);
  });

  it('allows only listed statuses', () => {
    const rule = { enabledOrderStatuses: ['PAID', 'DELIVERED'] };
    expect(isOrderStatusNotificationEnabled(rule, { status: 'PAID' })).toBe(true);
    expect(isOrderStatusNotificationEnabled(rule, { status: 'delivered' })).toBe(true);
    expect(isOrderStatusNotificationEnabled(rule, { status: 'CHECKING_AT_HUB' })).toBe(
      false,
    );
  });

  it('allows when meta has no status', () => {
    expect(
      isOrderStatusNotificationEnabled({ enabledOrderStatuses: ['PAID'] }, {}),
    ).toBe(true);
  });
});
