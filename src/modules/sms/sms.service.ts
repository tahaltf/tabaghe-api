import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class SmsService {
  constructor(private configService: ConfigService) {}

  async sendOtp(phone: string, code: string) {
    const apiKey = this.configService.get<string>('SMS_IR_API_KEY');
    const url = 'https://api.sms.ir/v1/send/verify';

    try {
      // طبق مستندات، بدنه درخواست باید دقیقاً به این شکل باشد
      const payload = {
        mobile: phone,
        templateId: 591069,
        parameters: [
          {
            name: 'CONTACTS',
            value: code,
          },
        ],
      };

      console.log('--- SMS.IR Request Payload ---', JSON.stringify(payload));

      const response = await axios.post(url, payload, {
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'text/plain',
          'Content-Type': 'application/json',
        },
      });

      // بر اساس مستندات، پاسخ موفق status برابر 1 است
      console.log('--- SMS.IR Response Data ---', response.data);

      if (response.data.status !== 1) {
        console.warn('SMS.IR returned non-success status:', response.data.message);
      }

      return response.data;

    } catch (error) {
      // لاگ کردن خطای دقیق برای پیدا کردن علت (مثلاً نبود موجودی یا کد قالب اشتباه)
      const errorDetail = error.response?.data;
      console.error('--- SMS.IR API Error ---', errorDetail || error.message);

      throw new InternalServerErrorException(
        errorDetail?.message || 'خطا در برقراری ارتباط با سامانه پیامک',
      );
    }
  }
}