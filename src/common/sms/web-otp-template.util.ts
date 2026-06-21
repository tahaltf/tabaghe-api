export const SMS_OTP_TEMPLATE_ID_DEFAULT = 591069;
export const SMS_OTP_CODE_PARAMETER_DEFAULT = 'CONTACTS';

/** Host bound in Android Web OTP — must match SMS last line and site origin. */
export function resolveSmsWebOtpOrigin(): string {
  const raw = process.env.SMS_WEB_OTP_ORIGIN?.trim();
  if (raw) return raw.replace(/^@+/, '').replace(/\/+$/, '');
  return 'tabagheh.com';
}

export type SmsWebOtpTemplateGuide = {
  templateId: number;
  codeParameterName: string;
  origin: string;
  /** Last line required in sms.ir template for Web OTP autofill. */
  requiredLastLine: string;
  /** Example full SMS body for ops / sms.ir panel. */
  exampleBody: string;
  checklist: string[];
};

export function buildSmsWebOtpTemplateGuide(
  codeParameterName = SMS_OTP_CODE_PARAMETER_DEFAULT,
  templateId = SMS_OTP_TEMPLATE_ID_DEFAULT,
): SmsWebOtpTemplateGuide {
  const origin = resolveSmsWebOtpOrigin();
  const requiredLastLine = `@${origin} #${codeParameterName}`;
  const exampleBody = [
    `کد تایید طبقه: #${codeParameterName}`,
    requiredLastLine,
  ].join('\n');

  return {
    templateId,
    codeParameterName,
    origin,
    requiredLastLine,
    exampleBody,
    checklist: [
      `Template ID ${templateId} in sms.ir must include parameter #${codeParameterName} for the OTP digits.`,
      `Last line of template must be exactly: ${requiredLastLine}`,
      'sms.ir must NOT append extra text after the origin-bound line.',
      'Use tabagheh.com (no www) to match production origin.',
      'After editing template, test on Chrome Android with drawer tap autofill.',
    ],
  };
}

/** Validates that configured origin looks usable for Web OTP. */
export function assertSmsWebOtpOriginConfigured(): string[] {
  const warnings: string[] = [];
  const origin = resolveSmsWebOtpOrigin();
  if (origin.includes('localhost')) {
    warnings.push('SMS_WEB_OTP_ORIGIN is localhost — Web OTP only works with real domain in SMS.');
  }
  if (origin.startsWith('www.')) {
    warnings.push('SMS_WEB_OTP_ORIGIN should not include www — use apex domain (tabagheh.com).');
  }
  return warnings;
}
