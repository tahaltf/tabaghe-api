import { BadGatewayException, Injectable } from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import {
  GatewayRequestPayload,
  GatewayRequestResult,
  GatewayVerifyPayload,
  GatewayVerifyResult,
  PaymentGateway,
} from './payment-gateway.interface';

type ZibalRequestResponse = {
  result: number;
  message: string;
  trackId?: number | string;
};

type ZibalVerifyResponse = {
  result: number;
  message: string;
  refNumber?: number | string;
  paidAt?: string;
  amount?: number;
};

@Injectable()
export class ZibalGateway implements PaymentGateway {
  readonly name = 'zibal' as const;
  private static readonly TOMAN_TO_RIAL = 10;

  constructor(private readonly appSettings: AppSettingsService) {}

  async requestPayment(payload: GatewayRequestPayload): Promise<GatewayRequestResult> {
    const cfg = this.appSettings.getPaymentGatewayConfig();
    // App amounts are stored in toman, while Zibal expects rial.
    const amountInRial = Math.round(payload.amount * ZibalGateway.TOMAN_TO_RIAL);
    const body = {
      merchant: cfg.merchant,
      amount: amountInRial,
      callbackUrl: payload.callbackUrl,
      orderId: payload.orderId,
      description: payload.description,
      mobile: payload.mobile,
    };

    const { data } = await axios.post<ZibalRequestResponse>(cfg.requestUrl, body, {
      timeout: 15_000,
    });

    if (!data || data.result !== 100 || !data.trackId) {
      throw new BadGatewayException(
        data?.message || 'خطا در دریافت لینک پرداخت از زیبال',
      );
    }

    const authority = String(data.trackId);
    return {
      authority,
      paymentUrl: this.appSettings.buildZibalStartPayUrl(authority),
      raw: data,
    };
  }

  async verifyPayment(payload: GatewayVerifyPayload): Promise<GatewayVerifyResult> {
    const cfg = this.appSettings.getPaymentGatewayConfig();
    // Verification amount from app is toman; convert to rial for gateway check.
    const expectedAmountInRial = Math.round(
      payload.expectedAmount * ZibalGateway.TOMAN_TO_RIAL,
    );
    const body = {
      merchant: cfg.merchant,
      trackId: payload.authority,
    };

    const { data } = await axios.post<ZibalVerifyResponse>(
      'https://gateway.zibal.ir/v1/verify',
      body,
      { timeout: 15_000 },
    );

    const paidAmount = this.parseVerifiedAmount(data?.amount);
    const amountMatches =
      paidAmount === null ? true : paidAmount === expectedAmountInRial;
    const success = data?.result === 100 && amountMatches;
    return {
      success,
      refId: data?.refNumber ? String(data.refNumber) : undefined,
      message: !amountMatches ? 'مبلغ تایید شده با سفارش یکسان نیست' : data?.message,
      raw: data,
    };
  }

  /** Zibal may return `amount` as number or numeric string (ریال). */
  private parseVerifiedAmount(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string' && raw.trim() !== '') {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  }
}
