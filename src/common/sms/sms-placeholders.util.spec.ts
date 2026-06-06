import { applySmsTemplatePlaceholders } from './sms-placeholders.util';

describe('applySmsTemplatePlaceholders', () => {
  it('maps {{status}} enum to Persian label', () => {
    const out = applySmsTemplatePlaceholders('وضعیت: {{status}}', {
      meta: { status: 'CHECKING_AT_HUB' },
    });
    expect(out).toBe('وضعیت: در حال بررسی در هاب');
  });

  it('maps humanized status text to Persian label', () => {
    const out = applySmsTemplatePlaceholders('وضعیت: {{status}}', {
      meta: { status: 'checking in hub' },
    });
    expect(out).toBe('وضعیت: در حال بررسی در هاب');
  });

  it('prefers statusLabel from enriched meta', () => {
    const out = applySmsTemplatePlaceholders('{{status}}', {
      meta: { status: 'CHECKING_AT_HUB', statusLabel: 'در حال بررسی در هاب' },
    });
    expect(out).toBe('در حال بررسی در هاب');
  });

  it('falls back {{note}} to message when meta.note is absent', () => {
    const out = applySmsTemplatePlaceholders('{{firstName}}: {{note}}', {
      firstName: 'علی',
      message: 'کالای آگهی از انبار برای شما ارسال شد.',
    });
    expect(out).toBe('علی: کالای آگهی از انبار برای شما ارسال شد.');
  });

  it('prefers meta.note over message fallback', () => {
    const out = applySmsTemplatePlaceholders('{{note}}', {
      message: 'متن کامل با کد رهگیری',
      meta: { note: 'کالای آگهی از انبار برای شما ارسال شد.' },
    });
    expect(out).toBe('کالای آگهی از انبار برای شما ارسال شد.');
  });

  it('maps financial settlement meta to Persian label', () => {
    const out = applySmsTemplatePlaceholders('وضعیت: {{status}}', {
      meta: {
        status: 'VERIFIED_AT_HUB',
        statusLabel: 'تایید با اصلاح مالی',
        resolution: 'FINANCIAL_SETTLEMENT_THEN_SHIP',
      },
    });
    expect(out).toBe('وضعیت: تایید با اصلاح مالی');
  });
});
