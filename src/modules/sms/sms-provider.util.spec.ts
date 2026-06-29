import {
  parseSmsProviderOverride,
  resolveEffectiveSmsProvider,
} from './sms-provider.util';
import { SmsProviderName } from './gateways/sms-provider.interface';

describe('sms-provider.util', () => {
  describe('parseSmsProviderOverride', () => {
    it('returns undefined for empty or default', () => {
      expect(parseSmsProviderOverride('')).toBeUndefined();
      expect(parseSmsProviderOverride('default')).toBeUndefined();
      expect(parseSmsProviderOverride('  DEFAULT  ')).toBeUndefined();
    });

    it('parses known providers', () => {
      expect(parseSmsProviderOverride('smsir')).toBe('smsir');
      expect(parseSmsProviderOverride('Kavenegar')).toBe('kavenegar');
    });

    it('returns undefined for invalid values', () => {
      expect(parseSmsProviderOverride('twilio')).toBeUndefined();
    });
  });

  describe('resolveEffectiveSmsProvider', () => {
    const fallback: SmsProviderName = 'smsir';

    it('uses fallback when override is missing', () => {
      expect(resolveEffectiveSmsProvider(undefined, fallback)).toBe('smsir');
      expect(resolveEffectiveSmsProvider('default', fallback)).toBe('smsir');
    });

    it('uses override when set', () => {
      expect(resolveEffectiveSmsProvider('kavenegar', fallback)).toBe('kavenegar');
      expect(resolveEffectiveSmsProvider('smsir', 'kavenegar')).toBe('smsir');
    });
  });
});
