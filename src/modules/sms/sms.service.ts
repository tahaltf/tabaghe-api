import { Injectable, InternalServerErrorException } from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../shared/settings/app-settings.service';

const ADMIN_LOGIN_ALERT_PHONE = '09190949469';
const ADMIN_LOGIN_ALERT_TEMPLATE_ID = 176584;

@Injectable()
export class SmsService {
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

      if (response.data.status !== 1) {
        console.warn('SMS.IR returned non-success status:', response.data.message);
      }
      return response.data;
    } catch (error: any) {
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
