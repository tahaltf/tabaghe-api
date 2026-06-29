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

@Injectable()
export class SmsIrProvider implements SmsProvider {
  readonly name = 'smsir' as const;
  private readonly logger = new Logger(SmsIrProvider.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  async sendByTemplate(
    phone: string,
    template: SmsTemplateRef,
    parameters: SmsTemplateParameter[],
  ) {
    const templateId = Number(template.templateId);
    if (!Number.isFinite(templateId) || templateId <= 0) {
      throw new InternalServerErrorException(
        'شناسه قالب sms.ir تنظیم نشده یا نامعتبر است',
      );
    }

    const apiKey = this.appSettings.getSmsIrApiKey();
    const url = 'https://api.sms.ir/v1/send/verify';

    try {
      const payload = {
        mobile: phone,
        templateId,
        parameters,
      };

      const response = await axios.post(url, payload, {
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'text/plain',
          'Content-Type': 'application/json',
        },
      });

      const status = Number(response.data?.status);
      if (status !== 1) {
        const message =
          response.data?.message || 'SMS.IR returned non-success status';
        this.logger.warn(
          `SMS.IR rejected template ${templateId} for ${phone}: ${message}`,
        );
        throw new InternalServerErrorException(message);
      }
      this.logger.log(`SMS.IR accepted template ${templateId} for ${phone}.`);
      return response.data;
    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const err = error as { response?: { data?: { message?: string } } };
      const errorDetail = err.response?.data;
      throw new InternalServerErrorException(
        errorDetail?.message || 'خطا در برقراری ارتباط با سامانه پیامک',
      );
    }
  }
}
