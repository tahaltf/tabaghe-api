import { Injectable } from '@nestjs/common';
import { SmsProviderName } from '../../modules/sms/gateways/sms-provider.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ServerSecretConfigService } from './server-secret-config.service';
import {
  type PaymentGatewayConfigItem,
  type PaymentGatewayName,
  getPaymentGatewayCatalogEntry,
  isKnownPaymentGatewayType,
  parsePaymentGatewaysJson,
} from '../../modules/payments/payment-gateways.catalog';

export type { PaymentGatewayName };

@Injectable()
export class AppSettingsService {
  constructor(
    private readonly secrets: ServerSecretConfigService,
    private readonly prisma: PrismaService,
  ) {}

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

  getSmsIrLineNumber(): string {
    return this.secrets.get('SMS_IR_LINE_NUMBER')?.trim() ?? '';
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

  getPaymentGatewayConfig(gateway: PaymentGatewayName = 'zibal') {
    if (gateway === 'zibal') {
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
        provider: 'zibal' as const,
        merchant,
        requestUrl,
        startPayBaseUrl,
        callbackUrl,
        verifyUrl,
      };
    }
    throw new Error(`پیکربندی درگاه پشتیبانی نمی‌شود: ${gateway}`);
  }

  buildZibalStartPayUrl(trackId: string): string {
    const { startPayBaseUrl } = this.getPaymentGatewayConfig('zibal');
    return `${startPayBaseUrl}/${trackId}`;
  }

  buildCallbackUrl(gateway: PaymentGatewayName, base?: string): string {
    const root = (base || this.getApiUrl()).replace(/\/$/, '');
    return `${root}/api/v1/payments/callback/${gateway}`;
  }

  /**
   * Fallback when PAYMENT_GATEWAYS_JSON is empty: env ACTIVE_PAYMENT_GATEWAY
   * or default zibal enabled.
   */
  private fallbackPaymentGateways(): PaymentGatewayConfigItem[] {
    const configured = this.secrets
      .get('ACTIVE_PAYMENT_GATEWAY')
      ?.trim()
      .toLowerCase();
    const type: PaymentGatewayName =
      configured && isKnownPaymentGatewayType(configured)
        ? configured
        : 'zibal';
    const catalog = getPaymentGatewayCatalogEntry(type)!;
    return [
      {
        id: type,
        type,
        label: catalog.defaultLabel,
        enabled: true,
        sortOrder: 0,
      },
    ];
  }

  async getPaymentGateways(): Promise<PaymentGatewayConfigItem[]> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'PAYMENT_GATEWAYS_JSON' },
      select: { value: true },
    });
    const parsed = parsePaymentGatewaysJson(row?.value);
    if (parsed.length > 0) return parsed;
    return this.fallbackPaymentGateways();
  }

  async getEnabledPaymentGateways(): Promise<PaymentGatewayConfigItem[]> {
    return (await this.getPaymentGateways()).filter((g) => g.enabled);
  }

  /**
   * Resolve which gateway to use for a payment initiation.
   * - preferred if provided and enabled
   * - else exactly one enabled
   * - else error (caller throws BadRequest)
   */
  async resolvePaymentGatewayName(
    preferred?: string | null,
  ): Promise<PaymentGatewayName> {
    const enabled = await this.getEnabledPaymentGateways();
    if (enabled.length === 0) {
      throw new Error('NO_ENABLED_GATEWAY');
    }
    const pref = preferred?.trim().toLowerCase();
    if (pref) {
      const match = enabled.find((g) => g.type === pref || g.id === pref);
      if (!match) {
        throw new Error('GATEWAY_NOT_ENABLED');
      }
      return match.type;
    }
    if (enabled.length === 1) {
      return enabled[0].type;
    }
    throw new Error('GATEWAY_REQUIRED');
  }

  /** @deprecated Prefer resolvePaymentGatewayName / getEnabledPaymentGateways */
  getActivePaymentGateway(): PaymentGatewayName {
    const configured = this.secrets.get('ACTIVE_PAYMENT_GATEWAY');
    if (configured && isKnownPaymentGatewayType(configured)) return configured;
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
