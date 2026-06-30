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

  it('does not treat listingId as listingTitle in placeholder output', () => {
    const id = 'clxyz123456789abcdefghij';
    const out = applySmsTemplatePlaceholders('آگهی: {{listingTitle}}', {
      meta: { listingTitle: id, listingId: id },
    });
    expect(out).toBe('آگهی: یک آگهی');
  });

  it('maps trade context placeholders for SMS templates', () => {
    const out = applySmsTemplatePlaceholders(
      'آگهی: {{listingTitle}} | پیشنهاد: {{offerTitle}} | مالک: {{ownerName}} | خریدار: {{buyerName}} | فروشنده: {{sellerOrderStatusFa}} | خریدار: {{buyerOrderStatusFa}}',
      {
        meta: {
          listingTitle: 'لپ‌تاپ',
          offerTitle: 'گوشی',
          ownerName: 'علی رضایی',
          buyerName: 'سارا احمدی',
          sellerOrderStatusFa: 'ارسال شد',
          buyerOrderStatusFa: 'در انتظار دریافت',
        },
      },
    );
    expect(out).toContain('لپ‌تاپ');
    expect(out).toContain('گوشی');
    expect(out).toContain('علی رضایی');
    expect(out).toContain('سارا احمدی');
    expect(out).toContain('ارسال شد');
    expect(out).toContain('در انتظار دریافت');
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
