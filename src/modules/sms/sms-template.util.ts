import { SmsProviderName, SmsTemplateRef } from './gateways/sms-provider.interface';
import { resolveEffectiveSmsProvider } from './sms-provider.util';

export type SmsTemplateConfigLike = {
  templateId?: number;
  templateName?: string;
  smsProvider?: string;
};

export function resolveSmsProviderForConfig(
  config: SmsTemplateConfigLike | undefined,
  defaultProvider: SmsProviderName,
): SmsProviderName {
  return resolveEffectiveSmsProvider(config?.smsProvider, defaultProvider);
}

export function resolveSmsTemplateRef(
  config: SmsTemplateConfigLike | undefined,
  provider: SmsProviderName,
): SmsTemplateRef | undefined {
  if (!config) return undefined;

  if (provider === 'kavenegar') {
    const templateName = config.templateName?.trim();
    return templateName ? { templateName } : undefined;
  }

  const templateId = Number(config.templateId);
  if (Number.isFinite(templateId) && templateId > 0) {
    return { templateId };
  }
  return undefined;
}

export function hasSmsTemplateConfigured(
  config: SmsTemplateConfigLike | undefined,
  defaultProvider: SmsProviderName,
): boolean {
  const provider = resolveSmsProviderForConfig(config, defaultProvider);
  return resolveSmsTemplateRef(config, provider) !== undefined;
}
