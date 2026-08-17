import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import type { ZohalEnvelope, ZohalInquiryPath } from './zohal.types';

const DEFAULT_BASE_URL = 'https://service.zohal.io/api/v0/services';

@Injectable()
export class ZohalClient {
  private readonly logger = new Logger(ZohalClient.name);

  constructor(private readonly appSettings: AppSettingsService) {}

  isConfigured(): boolean {
    return Boolean(this.appSettings.getZohalToken());
  }

  async post<T>(
    path: ZohalInquiryPath,
    body: Record<string, unknown>,
  ): Promise<ZohalEnvelope<T>> {
    const token = this.appSettings.getZohalToken();
    if (!token) {
      throw new ServiceUnavailableException(
        'سرویس استعلام پیکربندی نشده است. توکن را در تنظیمات ادمین وارد کنید.',
      );
    }

    const baseUrl = this.appSettings.getZohalBaseUrl() || DEFAULT_BASE_URL;
    const url = `${baseUrl.replace(/\/$/, '')}/${path}`;

    try {
      const res = await axios.post<unknown>(url, body, {
        timeout: 20_000,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
        },
        validateStatus: () => true,
      });

      if (res.status === 401 || res.status === 403) {
        throw new BadGatewayException('توکن استعلام نامعتبر است.');
      }

      const envelope = parseEnvelope<T>(res.data);
      if (envelope) {
        const result = Number(envelope.result);
        const errorCode = String(envelope.response_body?.error_code ?? '');
        if (res.status >= 400 || result !== 1) {
          this.logger.warn(
            `inquiry ${path} http=${res.status} result=${result} error_code=${errorCode || '-'}`,
          );
        }
      }

      // Doc: 500 INTERNAL_ERROR, 503 SERVICE_UNAVAILABLE — always a provider failure.
      if (res.status >= 500) {
        const message = envelope
          ? String(envelope.response_body?.message ?? '').trim()
          : '';
        throw new BadGatewayException(
          message && !/موفق/.test(message)
            ? message
            : 'خطا در ارتباط با سرویس استعلام',
        );
      }

      if (!envelope) {
        throw new BadGatewayException('پاسخ نامعتبر از سرویس استعلام');
      }

      return envelope;
    } catch (err) {
      if (
        err instanceof BadGatewayException ||
        err instanceof ServiceUnavailableException
      ) {
        throw err;
      }
      const message = this.describeNetworkError(err);
      this.logger.warn(`inquiry ${path} failed: ${message}`);
      throw new BadGatewayException(message);
    }
  }

  private describeNetworkError(err: unknown): string {
    const anyErr = err as {
      code?: string;
      message?: string;
      response?: { status?: number };
    };
    const code = String(anyErr?.code ?? '');
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return 'سرور به سرویس استعلام دسترسی ندارد (DNS).';
    }
    if (code === 'ECONNABORTED' || /timeout/i.test(String(anyErr?.message))) {
      return 'زمان پاسخ سرویس استعلام به پایان رسید.';
    }
    return 'خطا در ارتباط با سرویس استعلام';
  }
}

function parseEnvelope<T>(raw: unknown): ZohalEnvelope<T> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!('result' in obj)) return null;
  const body = obj.response_body;
  if (!body || typeof body !== 'object') {
    return {
      result: Number(obj.result),
      response_body: { data: {} as T, error_code: null, message: '' },
    };
  }
  const rb = body as Record<string, unknown>;
  return {
    result: Number(obj.result),
    response_body: {
      data: (rb.data ?? {}) as T,
      error_code: (rb.error_code as string | null) ?? null,
      message: String(rb.message ?? ''),
    },
  };
}
