import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import axios from 'axios';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { buildSmsIrSignedHeaders, SMS_IR_BASE_URL } from './smsir-signature.util';
import type {
  SmsIrApiResponse,
  SmsIrTemplate,
  SmsIrTemplatesPage,
} from './smsir.types';

@Injectable()
export class SmsIrApiClient {
  constructor(private readonly appSettings: AppSettingsService) {}

  private get apiKey(): string {
    const key = this.appSettings.getSmsIrApiKey()?.trim();
    if (!key) {
      throw new BadRequestException(
        'کلید API سرویس sms.ir تنظیم نشده است. از بخش کلیدهای سرور مقدار SMS_IR_API_KEY را وارد کنید.',
      );
    }
    return key;
  }

  async getCredit(): Promise<number> {
    const data = await this.get<number | { credit?: number }>('/credit');
    if (typeof data === 'number') return data;
    if (data && typeof data === 'object' && typeof data.credit === 'number') {
      return data.credit;
    }
    throw new InternalServerErrorException('پاسخ اعتبار sms.ir نامعتبر است');
  }

  async listTemplates(
    pageNumber = 1,
    pageSize = 20,
  ): Promise<SmsIrTemplatesPage> {
    const raw = await this.signedRequest<unknown>('GET', '/templates', undefined, {
      pageNumber,
      pageSize,
    });
    return this.normalizeTemplatesPage(raw, pageNumber, pageSize);
  }

  async listAllTemplates(): Promise<SmsIrTemplate[]> {
    const pageSize = 100;
    const first = await this.listTemplates(1, pageSize);
    const items = [...(first.items ?? [])];
    const total = first.totalCount ?? items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    for (let page = 2; page <= totalPages; page += 1) {
      const next = await this.listTemplates(page, pageSize);
      items.push(...(next.items ?? []));
    }

    return items;
  }

  async createTemplate(
    title: string,
    templateText: string,
  ): Promise<SmsIrTemplate> {
    const data = await this.signedRequest<SmsIrTemplate>('POST', '/templates', {
      title,
      templateText,
    });
    return this.normalizeTemplate(data);
  }

  private async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const apiKey = this.apiKey;
    const { data } = await axios.get<SmsIrApiResponse<T>>(`${SMS_IR_BASE_URL}${path}`, {
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
      params,
    });
    this.assertSuccess(data);
    return data.data as T;
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    params?: Record<string, unknown>,
  ): Promise<T> {
    const headers = buildSmsIrSignedHeaders(this.apiKey);
    const { data } = await axios.request<SmsIrApiResponse<T>>({
      method,
      url: `${SMS_IR_BASE_URL}${path}`,
      headers,
      params,
      data: body,
    });
    this.assertSuccess(data);
    return data.data as T;
  }

  private assertSuccess(payload: SmsIrApiResponse<unknown>) {
    if (payload.status !== 1) {
      throw new BadRequestException(payload.message ?? 'خطا در ارتباط با sms.ir');
    }
  }

  private normalizeTemplatesPage(
    raw: unknown,
    pageNumber: number,
    pageSize: number,
  ): SmsIrTemplatesPage {
    if (Array.isArray(raw)) {
      return {
        items: raw.map((item) => this.normalizeTemplate(item)),
        totalCount: raw.length,
        pageNumber,
        pageSize,
      };
    }

    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>;
      const list =
        (Array.isArray(obj.items) && obj.items) ||
        (Array.isArray(obj.templates) && obj.templates) ||
        (Array.isArray(obj.data) && obj.data) ||
        [];

      return {
        items: list.map((item) => this.normalizeTemplate(item)),
        totalCount: Number(obj.totalCount ?? obj.total ?? list.length),
        pageNumber: Number(obj.pageNumber ?? pageNumber),
        pageSize: Number(obj.pageSize ?? pageSize),
      };
    }

    return { items: [], totalCount: 0, pageNumber, pageSize };
  }

  private normalizeTemplate(raw: unknown): SmsIrTemplate {
    const obj = (raw ?? {}) as Record<string, unknown>;
    return {
      id: Number(obj.id ?? obj.templateId ?? 0),
      title: String(obj.title ?? obj.name ?? ''),
      templateText: String(
        obj.templateText ?? obj.text ?? obj.messageText ?? '',
      ),
      status: Number(obj.status ?? 1) as SmsIrTemplate['status'],
      createDate: obj.createDate ? String(obj.createDate) : undefined,
      updateDate: obj.updateDate ? String(obj.updateDate) : undefined,
    };
  }
}
