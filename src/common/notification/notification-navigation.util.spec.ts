import { resolveNotificationPath } from './notification-navigation.util';

describe('notification-navigation.util', () => {
  it('returns null for admin-only alerts', () => {
    expect(
      resolveNotificationPath('ADMIN_ALERT_NEW_TICKET', { ticketId: 't1' }),
    ).toBeNull();
  });

  it('resolves order and ticket paths', () => {
    expect(
      resolveNotificationPath('ORDER_STATUS_CHANGED', { orderId: 'o1' }),
    ).toBe('/orders/o1');
    expect(
      resolveNotificationPath('TICKET_REPLY', { ticketId: 't1' }),
    ).toBe('/dashboard/support?ticketId=t1');
  });
});
