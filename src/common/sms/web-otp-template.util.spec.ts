import {
  buildSmsWebOtpTemplateGuide,
  assertSmsWebOtpOriginConfigured,
  SMS_OTP_CODE_PARAMETER_DEFAULT,
} from './web-otp-template.util';

describe('web-otp-template.util', () => {
  const prevOrigin = process.env.SMS_WEB_OTP_ORIGIN;

  afterEach(() => {
    if (prevOrigin === undefined) delete process.env.SMS_WEB_OTP_ORIGIN;
    else process.env.SMS_WEB_OTP_ORIGIN = prevOrigin;
  });

  it('builds required last line for Android Web OTP', () => {
    delete process.env.SMS_WEB_OTP_ORIGIN;
    const guide = buildSmsWebOtpTemplateGuide();
    expect(guide.requiredLastLine).toBe(
      `@tabagheh.com #${SMS_OTP_CODE_PARAMETER_DEFAULT}`,
    );
    expect(guide.exampleBody).toContain(guide.requiredLastLine);
  });

  it('warns when origin uses www', () => {
    process.env.SMS_WEB_OTP_ORIGIN = 'www.tabagheh.com';
    const warnings = assertSmsWebOtpOriginConfigured();
    expect(warnings.some((w) => w.includes('www'))).toBe(true);
  });
});
