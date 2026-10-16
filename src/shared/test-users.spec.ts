import {
  GODADMIN_PHONE,
  isTestOtpEnabled,
  shouldUseFixedTestOtp,
} from './test-users';

describe('test OTP gating', () => {
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_TEST_OTP;

  afterEach(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_TEST_OTP;
    else process.env.ALLOW_TEST_OTP = prevAllow;
  });

  it('disables fixed OTP in production by default', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_TEST_OTP;
    expect(isTestOtpEnabled()).toBe(false);
    expect(shouldUseFixedTestOtp(GODADMIN_PHONE)).toBe(false);
    expect(shouldUseFixedTestOtp('09190000001')).toBe(false);
  });

  it('allows fixed OTP in production when ALLOW_TEST_OTP=1', () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_TEST_OTP = '1';
    expect(isTestOtpEnabled()).toBe(true);
    expect(shouldUseFixedTestOtp(GODADMIN_PHONE)).toBe(true);
  });

  it('allows fixed OTP outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.ALLOW_TEST_OTP;
    expect(shouldUseFixedTestOtp('09190000001')).toBe(true);
  });
});
