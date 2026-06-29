export type SmsProviderName = 'smsir' | 'kavenegar';

export type SmsTemplateRef = {
  templateId?: number;
  templateName?: string;
};

export type SmsTemplateParameter = { name: string; value: string };

export interface SmsProvider {
  readonly name: SmsProviderName;
  sendByTemplate(
    phone: string,
    template: SmsTemplateRef,
    parameters: SmsTemplateParameter[],
  ): Promise<unknown>;
}
