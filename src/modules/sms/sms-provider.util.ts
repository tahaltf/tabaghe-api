import { SmsProviderName } from './gateways/sms-provider.interface';

export type SmsProviderOverride = SmsProviderName | 'default' | '';

export function parseSmsProviderOverride(
  raw: string | undefined | null,
): SmsProviderOverride | undefined {
  const v = raw?.trim().toLowerCase();
  if (!v || v === 'default') return undefined;
  if (v === 'kavenegar') return 'kavenegar';
  if (v === 'smsir') return 'smsir';
  return undefined;
}

export function resolveEffectiveSmsProvider(
  override: string | undefined | null,
  fallback: SmsProviderName,
): SmsProviderName {
  const parsed = parseSmsProviderOverride(override);
  if (parsed === 'kavenegar') return 'kavenegar';
  if (parsed === 'smsir') return 'smsir';
  return fallback;
}
