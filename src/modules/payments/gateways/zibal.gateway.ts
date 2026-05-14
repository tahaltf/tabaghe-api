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

  async requestPayment(
    payload: GatewayRequestPayload,
  ): Promise<GatewayRequestResult> {
    const cfg = this.appSettings.getPaymentGatewayConfig();
    // App amounts are stored in toman, while Zibal expects rial.
    const amountInRial = Math.round(
      payload.amount * ZibalGateway.TOMAN_TO_RIAL,
    );
    const body = {
      merchant: cfg.merchant,
      amount: amountInRial,
      callbackUrl: payload.callbackUrl,
      orderId: payload.orderId,
      description: payload.description,
      mobile: payload.mobile,
    };

    let data: ZibalRequestResponse;
    try {
      data = await this.postToZibalWithRetry<ZibalRequestResponse>(
        cfg.requestUrl,
        body,
      );
    } catch (err) {
      this.rethrowZibalHttpError(err, 'request');
    }

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

  async verifyPayment(
    payload: GatewayVerifyPayload,
  ): Promise<GatewayVerifyResult> {
    const cfg = this.appSettings.getPaymentGatewayConfig();
    // Verification amount from app is toman; convert to rial for gateway check.
    const expectedAmountInRial = Math.round(
      payload.expectedAmount * ZibalGateway.TOMAN_TO_RIAL,
    );
    const body = {
      merchant: cfg.merchant,
      trackId: payload.authority,
    };

    let data: ZibalVerifyResponse;
    try {
      data = await this.postToZibalWithRetry<ZibalVerifyResponse>(
        cfg.verifyUrl,
        body,
      );
    } catch (err) {
      this.rethrowZibalHttpError(err, 'verify');
    }

    const paidAmount = this.parseVerifiedAmount(data?.amount);
    const amountMatches =
      paidAmount === null ? true : paidAmount === expectedAmountInRial;
    const success = data?.result === 100 && amountMatches;
    return {
      success,
      refId: data?.refNumber ? String(data.refNumber) : undefined,
      message: !amountMatches
        ? 'مبلغ تایید شده با سفارش یکسان نیست'
        : data?.message,
      raw: data,
    };
  }

  private rethrowZibalHttpError(
    err: unknown,
    context: 'request' | 'verify',
  ): never {
    const code = this.resolveNetworkErrnoCode(err);
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new BadGatewayException(
        'سرور نمی‌تواند نام دامنهٔ درگاه زیبال را پیدا کند (ENOTFOUND). اینترنت، DNS یا فیلترینگ را بررسی کنید؛ باید به gateway.zibal.ir دسترسی باشد.',
      );
    }
    if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
      throw new BadGatewayException(
        'اتصال به سرور زیبال برقرار نشد (timeout یا رد اتصال). فایروال یا پروکسی را بررسی کنید.',
      );
    }
    const ax = err as {
      message?: string;
      response?: { data?: unknown };
    };
    const body = ax.response?.data;
    if (
      body &&
      typeof body === 'object' &&
      body !== null &&
      'message' in body
    ) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === 'string' && m.trim()) {
        throw new BadGatewayException(m);
      }
    }
    if (typeof ax.message === 'string' && ax.message.trim()) {
      throw new BadGatewayException(
        ax.message ||
          (context === 'verify'
            ? 'خطا در تأیید تراکنش زیبال'
            : 'خطا در درخواست زیبال'),
      );
    }
    throw err instanceof Error
      ? err
      : new BadGatewayException('خطای ناشناخته در ارتباط با زیبال');
  }

  private async postToZibalWithRetry<T>(
    url: string,
    body: unknown,
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const res = await axios.post<T>(url, body, { timeout: 15_000 });
        return res.data;
      } catch (err) {
        lastError = err;
        const code = this.resolveNetworkErrnoCode(err);
        const transient =
          code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'ETIMEDOUT';
        if (!transient || attempt === 2) break;
        await this.sleep(350);
      }
    }
    throw lastError;
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** زنجیرهٔ cause (axios + Node) برای ENOTFOUND / EAI_AGAIN */
  private resolveNetworkErrnoCode(err: unknown): string | undefined {
    const visited = new WeakSet<object>();
    let current: unknown = err;
    for (let depth = 0; depth < 12 && current != null; depth++) {
      if (typeof current !== 'object' || current === null) break;
      if (visited.has(current as object)) break;
      visited.add(current as object);
      const ne = current as NodeJS.ErrnoException;
      if (typeof ne.code === 'string' && ne.code) return ne.code;
      current = (current as { cause?: unknown }).cause;
    }
    return undefined;
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
