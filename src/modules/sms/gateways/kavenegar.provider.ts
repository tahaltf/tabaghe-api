import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import {
  SmsProvider,
  SmsTemplateParameter,
  SmsTemplateRef,
} from './sms-provider.interface';

const KAVENEGAR_TOKEN_SLOTS = [
  'token',
  'token2',
  'token3',
  'token10',
  'token20',
] as const;

type KavenegarLookupResponse = {
  return?: { status?: number; message?: string };
  entries?: unknown[];
};

@Injectable()
export class KavenegarProvider implements SmsProvider {
  readonly name = 'kavenegar' as const;
  private readonly logger = new Logger(KavenegarProvider.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  static mapParametersToTokens(
    parameters: SmsTemplateParameter[],
  ): Record<string, string> {
    const tokens: Record<string, string> = {};
    const namedSlots = new Set<string>(KAVENEGAR_TOKEN_SLOTS);

    for (const param of parameters) {
      const name = param.name.trim().toLowerCase();
      if (namedSlots.has(name)) {
        tokens[name] = param.value;
      }
    }

    let slotIndex = 0;
    for (const param of parameters) {
      const name = param.name.trim().toLowerCase();
      if (namedSlots.has(name)) continue;
      while (
        slotIndex < KAVENEGAR_TOKEN_SLOTS.length &&
        tokens[KAVENEGAR_TOKEN_SLOTS[slotIndex]]
      ) {
        slotIndex++;
      }
      if (slotIndex >= KAVENEGAR_TOKEN_SLOTS.length) break;
      tokens[KAVENEGAR_TOKEN_SLOTS[slotIndex]] = param.value;
      slotIndex++;
    }

    return tokens;
  }

  async sendByTemplate(
    phone: string,
    template: SmsTemplateRef,
    parameters: SmsTemplateParameter[],
  ) {
    const templateName = template.templateName?.trim();
    if (!templateName) {
      throw new InternalServerErrorException(
        'نام الگوی کاوه‌نگار تنظیم نشده یا نامعتبر است',
      );
    }

    const apiKey = this.appSettings.getKavenegarApiKey();
    const url = `https://api.kavenegar.com/v1/${encodeURIComponent(apiKey)}/verify/lookup.json`;
    const tokens = KavenegarProvider.mapParametersToTokens(parameters);

    const query: Record<string, string> = {
      receptor: phone,
      template: templateName,
      ...tokens,
    };

    try {
      const response = await axios.get<KavenegarLookupResponse>(url, {
        params: query,
      });

      const status = Number(response.data?.return?.status);
      if (status !== 200) {
        const message =
          response.data?.return?.message ||
          'کاوه‌نگار پاسخ موفق برنگرداند';
        this.logger.warn(
          `Kavenegar rejected template "${templateName}" for ${phone}: ${message}`,
        );
        throw new InternalServerErrorException(message);
      }

      this.logger.log(
        `Kavenegar accepted template "${templateName}" for ${phone}.`,
      );
      return response.data;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const err = error as {
        response?: { data?: KavenegarLookupResponse };
      };
      const message = err.response?.data?.return?.message;
      throw new InternalServerErrorException(
        message || 'خطا در برقراری ارتباط با سامانه پیامک',
      );
    }
  }
}
