import { Injectable } from '@nestjs/common';
import { SmsProviderName } from '../../modules/sms/gateways/sms-provider.interface';
import { ServerSecretConfigService } from './server-secret-config.service';

export type PaymentGatewayName = 'zibal';

@Injectable()
export class AppSettingsService {
  constructor(private readonly secrets: ServerSecretConfigService) {}

  getActiveSmsProvider(): SmsProviderName {
    const configured = this.secrets
      .get('ACTIVE_SMS_PROVIDER')
      ?.trim()
      .toLowerCase();
    if (configured === 'kavenegar') return 'kavenegar';
    return 'smsir';
  }

  getSmsIrApiKey(): string {
    return this.secrets.get('SMS_IR_API_KEY');
  }

  /** @deprecated Use getSmsIrApiKey() */
  getSmsApiKey(): string {
    return this.getSmsIrApiKey();
  }

  getKavenegarApiKey(): string {
    return this.secrets.get('KAVENEGAR_API_KEY');
  }

  getApiUrl(): string {
    return this.secrets.get('API_URL') || 'https://api.tabagheh.com';
  }

  getFrontendAppUrl(): string {
    return this.secrets.get('FRONTEND_APP_URL') || 'https://tabagheh.com';
  }

  getPaymentGatewayConfig() {
    const merchant = this.secrets.get('ZIBAL_MERCHANT') || 'zibal';
    const requestUrl =
      this.secrets.get('ZIBAL_REQUEST_URL') ||
      'https://gateway.zibal.ir/v1/request';
    const startPayBaseUrl =
      this.secrets.get('ZIBAL_START_PAY_URL') ||
      'https://gateway.zibal.ir/start';
    const callbackUrl =
      this.secrets.get('ZIBAL_CALLBACK_URL') ||
      `${this.getApiUrl().replace(/\/$/, '')}/api/v1/payments/callback/zibal`;
    const verifyUrl =
      this.secrets.get('ZIBAL_VERIFY_URL') ||
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
    const configured = this.secrets.get('ACTIVE_PAYMENT_GATEWAY');
    if (configured === 'zibal') return configured;
    return 'zibal';
  }

  getPaymentReturnUrl(): string {
    return (
      this.secrets.get('PAYMENT_RETURN_URL') ||
      `${this.getFrontendAppUrl()}/payment-result`
    );
  }

  getZohalToken(): string {
    return this.secrets.get('ZOHAL_TOKEN')?.trim() || '';
  }

  getZohalBaseUrl(): string {
    return (
      this.secrets.get('ZOHAL_BASE_URL')?.trim() ||
      'https://service.zohal.io/api/v0/services'
    );
  }
}
