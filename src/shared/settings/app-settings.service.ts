import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SmsProviderName } from '../../modules/sms/gateways/sms-provider.interface';

export type PaymentGatewayName = 'zibal';

@Injectable()
export class AppSettingsService {
  constructor(private readonly configService: ConfigService) {}

  getActiveSmsProvider(): SmsProviderName {
    const configured = this.configService
      .get<string>('ACTIVE_SMS_PROVIDER')
      ?.trim()
      .toLowerCase();
    if (configured === 'kavenegar') return 'kavenegar';
    return 'smsir';
  }

  getSmsIrApiKey(): string {
    return this.configService.get<string>('SMS_IR_API_KEY') ?? '';
  }

  /** @deprecated Use getSmsIrApiKey() */
  getSmsApiKey(): string {
    return this.getSmsIrApiKey();
  }

  getKavenegarApiKey(): string {
    return this.configService.get<string>('KAVENEGAR_API_KEY') ?? '';
  }

  getApiUrl(): string {
    return (
      this.configService.get<string>('API_URL') ?? 'https://api.tabagheh.com'
    );
  }

  getFrontendAppUrl(): string {
    return (
      this.configService.get<string>('FRONTEND_APP_URL') ??
      'https://tabagheh.com'
    );
  }

  getPaymentGatewayConfig() {
    const merchant =
      this.configService.get<string>('ZIBAL_MERCHANT') ?? 'zibal';
    const requestUrl =
      this.configService.get<string>('ZIBAL_REQUEST_URL') ??
      'https://gateway.zibal.ir/v1/request';
    const startPayBaseUrl =
      this.configService.get<string>('ZIBAL_START_PAY_URL') ??
      'https://gateway.zibal.ir/start';
    const callbackUrl =
      this.configService.get<string>('ZIBAL_CALLBACK_URL') ??
      `${this.getApiUrl().replace(/\/$/, '')}/api/v1/payments/callback/zibal`;
    const verifyUrl =
      this.configService.get<string>('ZIBAL_VERIFY_URL') ??
      'https://gateway.zibal.ir/v1/verify';

    return {
      provider: 'zibal',
      merchant,
      requestUrl,
      startPayBaseUrl,
      callbackUrl,
      verifyUrl,
    };
  }

  buildZibalStartPayUrl(trackId: string): string {
    const { startPayBaseUrl } = this.getPaymentGatewayConfig();
    return `${startPayBaseUrl}/${trackId}`;
  }

  getActivePaymentGateway(): PaymentGatewayName {
    const configured = this.configService.get<string>('ACTIVE_PAYMENT_GATEWAY');
    if (configured === 'zibal') return configured;
    return 'zibal';
  }

  getPaymentReturnUrl(): string {
    return (
      this.configService.get<string>('PAYMENT_RETURN_URL') ??
      `${this.getFrontendAppUrl()}/payment-result`
    );
  }
}
