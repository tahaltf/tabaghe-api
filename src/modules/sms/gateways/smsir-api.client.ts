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
  SmsIrArchiveParams,
  SmsIrMessageReport,
  SmsIrPackSummary,
  SmsIrPageParams,
  SmsIrReceiveArchiveParams,
  SmsIrReceivedMessage,
  SmsIrReceiveLiveParams,
  SmsIrSendBulkResult,
  SmsIrTemplate,
  SmsIrTemplatesPage,
  SmsIrVerifyParameter,
  SmsIrVerifyResult,
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

  getDefaultLineNumber(): number | null {
    const value = this.appSettings.getSmsIrLineNumber();
    if (!value) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
  }

  async getCredit(): Promise<number> {
    const data = await this.get<number | { credit?: number }>('/credit');
    if (typeof data === 'number') return data;
    if (data && typeof data === 'object' && typeof data.credit === 'number') {
      return data.credit;
    }
    throw new InternalServerErrorException('پاسخ اعتبار sms.ir نامعتبر است');
  }

  async listLines(): Promise<number[]> {
    const data = await this.get<number[] | { lines?: number[] }>('/line');
    if (Array.isArray(data)) {
      return data.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    }
    if (data && typeof data === 'object' && Array.isArray(data.lines)) {
      return data.lines.map((n) => Number(n)).filter((n) => Number.isFinite(n));
    }
    return [];
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

  async getTemplate(templateId: number): Promise<SmsIrTemplate> {
    const raw = await this.signedRequest<unknown>(
      'GET',
      `/templates/${templateId}`,
    );
    return this.normalizeTemplate(raw);
  }

  async createTemplate(
    title: string,
    templateText: string,
    type?: number,
  ): Promise<SmsIrTemplate> {
    const body: Record<string, unknown> = { title, templateText };
    if (type != null) body.type = type;
    const data = await this.signedRequest<SmsIrTemplate | number>(
      'POST',
      '/templates',
      body,
    );
    if (typeof data === 'number') {
      return {
        id: data,
        title,
        templateText,
        status: 1,
      };
    }
    return this.normalizeTemplate(data);
  }

  async updateTemplate(
    templateId: number,
    title: string,
    templateText: string,
    type?: number,
  ): Promise<SmsIrTemplate> {
    const body: Record<string, unknown> = { title, templateText };
    if (type != null) body.type = type;
    const data = await this.signedRequest<SmsIrTemplate | number>(
      'PUT',
      `/templates/${templateId}`,
      body,
    );
    if (typeof data === 'number') {
      return {
        id: data || templateId,
        title,
        templateText,
        status: 1,
      };
    }
    return this.normalizeTemplate(data ?? { id: templateId, title, templateText });
  }

  async deleteTemplate(templateId: number): Promise<boolean> {
    await this.signedRequest<unknown>('DELETE', `/templates/${templateId}`);
    return true;
  }

  async sendBulk(input: {
    lineNumber: number;
    messageText: string;
    mobiles: string[];
    sendDateTime?: number | null;
  }): Promise<SmsIrSendBulkResult> {
    const body: Record<string, unknown> = {
      lineNumber: input.lineNumber,
      messageText: input.messageText,
      mobiles: input.mobiles,
    };
    if (input.sendDateTime != null) {
      body.sendDateTime = input.sendDateTime;
    }
    return this.normalizeSendResult(
      await this.post<SmsIrSendBulkResult>('/send/bulk', body),
    );
  }

  async sendLikeToLike(input: {
    lineNumber: number;
    messageTexts: string[];
    mobiles: string[];
    sendDateTime?: number | null;
  }): Promise<SmsIrSendBulkResult> {
    const body: Record<string, unknown> = {
      lineNumber: input.lineNumber,
      messageTexts: input.messageTexts,
      mobiles: input.mobiles,
    };
    if (input.sendDateTime != null) {
      body.sendDateTime = input.sendDateTime;
    }
    return this.normalizeSendResult(
      await this.post<SmsIrSendBulkResult>('/send/likeToLike', body),
    );
  }

  async deleteScheduled(packId: string): Promise<boolean> {
    await this.delete(`/send/scheduled/${encodeURIComponent(packId)}`);
    return true;
  }

  async sendVerify(input: {
    mobile: string;
    templateId: number;
    parameters: SmsIrVerifyParameter[];
  }): Promise<SmsIrVerifyResult> {
    const data = await this.post<SmsIrVerifyResult>('/send/verify', {
      mobile: input.mobile,
      templateId: input.templateId,
      parameters: input.parameters,
    });
    return {
      messageId: Number(data?.messageId ?? 0),
      cost: Number(data?.cost ?? 0),
    };
  }

  /** Single-recipient send via bulk (secure; avoids URL username/password). */
  async sendSimple(input: {
    lineNumber: number;
    mobile: string;
    text: string;
  }): Promise<SmsIrSendBulkResult> {
    return this.sendBulk({
      lineNumber: input.lineNumber,
      messageText: input.text,
      mobiles: [input.mobile],
    });
  }

  async getMessageReport(messageId: number): Promise<SmsIrMessageReport> {
    return this.normalizeMessageReport(
      await this.get<SmsIrMessageReport>(`/send/${messageId}`),
    );
  }

  async getTodayPacks(params: SmsIrPageParams = {}): Promise<SmsIrPackSummary[]> {
    const raw = await this.get<SmsIrPackSummary[] | { items?: SmsIrPackSummary[] }>(
      '/send/pack',
      {
        pageNumber: params.pageNumber ?? 1,
        pageSize: params.pageSize ?? 100,
      },
    );
    return this.asArray(raw).map((p) => ({
      packId: String(p.packId ?? ''),
      recipientCount: Number(p.recipientCount ?? 0),
      creationDateTime: Number(p.creationDateTime ?? 0),
    }));
  }

  async getPackMessages(packId: string): Promise<SmsIrMessageReport[]> {
    const raw = await this.get<SmsIrMessageReport[] | { items?: SmsIrMessageReport[] }>(
      `/send/pack/${encodeURIComponent(packId)}`,
    );
    return this.asArray(raw).map((m) => this.normalizeMessageReport(m));
  }

  async getLiveSends(params: SmsIrPageParams = {}): Promise<SmsIrMessageReport[]> {
    const raw = await this.get<SmsIrMessageReport[] | { items?: SmsIrMessageReport[] }>(
      '/send/live',
      {
        pageNumber: params.pageNumber ?? 1,
        pageSize: params.pageSize ?? 100,
      },
    );
    return this.asArray(raw).map((m) => this.normalizeMessageReport(m));
  }

  async getArchivedSends(
    params: SmsIrArchiveParams = {},
  ): Promise<SmsIrMessageReport[]> {
    const query: Record<string, unknown> = {
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 100,
    };
    if (params.fromDate != null) query.fromDate = params.fromDate;
    if (params.toDate != null) query.toDate = params.toDate;
    const raw = await this.get<SmsIrMessageReport[] | { items?: SmsIrMessageReport[] }>(
      '/send/archive',
      query,
    );
    return this.asArray(raw).map((m) => this.normalizeMessageReport(m));
  }

  async getLatestReceived(count = 100): Promise<SmsIrReceivedMessage[]> {
    const raw = await this.get<
      SmsIrReceivedMessage[] | { items?: SmsIrReceivedMessage[] }
    >('/receive/latest', { count: Math.min(100, Math.max(1, count)) });
    return this.asArray(raw).map((m) => this.normalizeReceived(m));
  }

  async getLiveReceived(
    params: SmsIrReceiveLiveParams = {},
  ): Promise<SmsIrReceivedMessage[]> {
    const query: Record<string, unknown> = {
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 100,
    };
    if (params.sortByNewest != null) query.sortByNewest = params.sortByNewest;
    if (params.mobile) query.mobile = params.mobile;
    const raw = await this.get<
      SmsIrReceivedMessage[] | { items?: SmsIrReceivedMessage[] }
    >('/receive/live', query);
    return this.asArray(raw).map((m) => this.normalizeReceived(m));
  }

  async getArchivedReceived(
    params: SmsIrReceiveArchiveParams = {},
  ): Promise<SmsIrReceivedMessage[]> {
    const query: Record<string, unknown> = {
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 100,
    };
    if (params.fromDate != null) query.fromDate = params.fromDate;
    if (params.toDate != null) query.toDate = params.toDate;
    if (params.sortByNewest != null) query.sortByNewest = params.sortByNewest;
    const raw = await this.get<
      SmsIrReceivedMessage[] | { items?: SmsIrReceivedMessage[] }
    >('/receive/archive', query);
    return this.asArray(raw).map((m) => this.normalizeReceived(m));
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

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const apiKey = this.apiKey;
    const { data } = await axios.post<SmsIrApiResponse<T>>(
      `${SMS_IR_BASE_URL}${path}`,
      body,
      {
        headers: {
          'X-API-KEY': apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    );
    this.assertSuccess(data);
    return data.data as T;
  }

  private async delete<T>(path: string): Promise<T> {
    const apiKey = this.apiKey;
    const { data } = await axios.request<SmsIrApiResponse<T>>({
      method: 'DELETE',
      url: `${SMS_IR_BASE_URL}${path}`,
      headers: {
        'X-API-KEY': apiKey,
        Accept: 'application/json',
      },
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

  private asArray<T>(raw: T[] | { items?: T[] } | null | undefined): T[] {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object' && Array.isArray((raw as { items?: T[] }).items)) {
      return (raw as { items: T[] }).items;
    }
    return [];
  }

  private normalizeSendResult(raw: SmsIrSendBulkResult): SmsIrSendBulkResult {
    return {
      packId: String(raw?.packId ?? ''),
      messageIds: Array.isArray(raw?.messageIds)
        ? raw.messageIds.map((id) => Number(id))
        : [],
      cost: Number(raw?.cost ?? 0),
    };
  }

  private normalizeMessageReport(raw: SmsIrMessageReport): SmsIrMessageReport {
    const obj = (raw ?? {}) as SmsIrMessageReport;
    return {
      messageId: Number(obj.messageId ?? 0),
      mobile: obj.mobile ?? '',
      messageText: String(obj.messageText ?? ''),
      sendDateTime: Number(obj.sendDateTime ?? 0),
      lineNumber: obj.lineNumber ?? '',
      cost: Number(obj.cost ?? 0),
      deliveryState:
        obj.deliveryState == null ? null : Number(obj.deliveryState),
      deliveryDateTime:
        obj.deliveryDateTime == null ? null : Number(obj.deliveryDateTime),
    };
  }

  private normalizeReceived(raw: SmsIrReceivedMessage): SmsIrReceivedMessage {
    const obj = (raw ?? {}) as SmsIrReceivedMessage;
    return {
      receiveReturnId:
        obj.receiveReturnId == null ? undefined : Number(obj.receiveReturnId),
      messageText: String(obj.messageText ?? ''),
      number: obj.number ?? '',
      mobile: obj.mobile ?? '',
      receivedDateTime: Number(obj.receivedDateTime ?? 0),
    };
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
      type: obj.type != null ? Number(obj.type) : undefined,
      parameters: Array.isArray(obj.parameters)
        ? (obj.parameters as Array<{ name: string; description?: string }>)
        : undefined,
    };
  }
}
