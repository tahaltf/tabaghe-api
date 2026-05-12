import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../shared/settings/app-settings.service';

const ADMIN_LOGIN_ALERT_PHONE = '09190949469';
const ADMIN_LOGIN_ALERT_TEMPLATE_ID = 176584;

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  async sendByTemplate(
    phone: string,
    templateId: number,
    parameters: Array<{ name: string; value: string }>,
  ) {
    const apiKey = this.appSettings.getSmsApiKey();
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
        const message = response.data?.message || 'SMS.IR returned non-success status';
        this.logger.warn(
          `SMS.IR rejected template ${templateId} for ${phone}: ${message}`,
        );
        throw new InternalServerErrorException(message);
      }
      this.logger.log(`SMS.IR accepted template ${templateId} for ${phone}.`);
      return response.data;
    } catch (error: any) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      const errorDetail = error.response?.data;
      throw new InternalServerErrorException(
        errorDetail?.message || 'خطا در برقراری ارتباط با سامانه پیامک',
      );
    }
  }

  async sendOtp(phone: string, code: string) {
    return this.sendByTemplate(phone, 591069, [{ name: 'CONTACTS', value: code }]);
  }

  async sendAdminLoginAlert(userPhone: string) {
    return this.sendByTemplate(ADMIN_LOGIN_ALERT_PHONE, ADMIN_LOGIN_ALERT_TEMPLATE_ID, [
      { name: 'PHONE', value: userPhone },
    ]);
  }
}
