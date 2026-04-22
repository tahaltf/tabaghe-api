import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  constructor(private configService: ConfigService) {}

  async sendByTemplate(
    phone: string,
    templateId: number,
    parameters: Array<{ name: string; value: string }>,
  ) {
    const apiKey = this.configService.get<string>('SMS_IR_API_KEY');
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
}