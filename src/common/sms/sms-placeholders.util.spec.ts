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
