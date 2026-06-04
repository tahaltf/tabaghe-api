import { isUserOperationalSmsEnabled } from './user-sms-notification.util';

describe('isUserOperationalSmsEnabled', () => {
  it('returns true only when notifySms is explicitly true', () => {
    expect(isUserOperationalSmsEnabled(true)).toBe(true);
    expect(isUserOperationalSmsEnabled(false)).toBe(false);
    expect(isUserOperationalSmsEnabled(undefined)).toBe(false);
    expect(isUserOperationalSmsEnabled(null)).toBe(false);
  });
});
