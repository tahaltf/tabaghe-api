import { SmsProviderName, SmsTemplateRef } from './gateways/sms-provider.interface';

export type SmsTemplateConfigLike = {
  templateId?: number;
  templateName?: string;
};

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
  provider: SmsProviderName,
): boolean {
  return resolveSmsTemplateRef(config, provider) !== undefined;
}
