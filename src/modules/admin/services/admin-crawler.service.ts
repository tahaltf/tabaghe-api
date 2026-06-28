import {
  BadGatewayException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { Response } from 'express';

@Injectable()
export class AdminCrawlerService {
  private readonly logger = new Logger(AdminCrawlerService.name);

  private get baseUrl(): string {
    return (process.env.CRAWLER_SERVICE_URL || 'http://127.0.0.1:5050').replace(/\/$/, '');
  }

  async getStatus() {
    return this.proxyGet('/status');
  }

  async getSettings() {
    return this.proxyGet('/api/settings');
  }

  async saveSettings(body: {
    login_phone: string;
    city: string;
    category: string;
    marketplace_only?: boolean;
    custom_list_url?: string;
    search_query?: string;
    search_city_wide?: boolean;
    batch_size?: number;
    price_sources?: Array<{ id: string; label?: string; enabled?: boolean }>;
  }) {
    return this.proxyPut('/api/settings', body);
  }

  async getSession() {
    return this.proxyGet('/api/session');
  }

  async requestOtp(phone: string) {
    return this.proxyPost('/api/auth/request-otp', { phone });
  }

  async verifyOtp(code: string) {
    return this.proxyPost('/api/auth/verify', { code });
  }

  async syncAuth() {
    return this.proxyPost('/api/auth/sync', {});
  }

  async logout() {
    try {
      await this.proxyPost('/api/crawler/stop', {});
    } catch (err) {
      this.logger.warn(
        'Crawler stop before Divar logout failed',
        err instanceof Error ? err.message : String(err),
      );
    }
    return this.proxyPost('/api/auth/logout', {});
  }

  async startCrawler() {
    return this.proxyPost('/api/crawler/start', {});
  }

  async stopCrawler() {
    return this.proxyPost('/api/crawler/stop', {});
  }

  async submitCrawlOtp(code: string) {
    return this.proxyPost('/api/crawler/otp', { code });
  }

  async submitCaptchaResolved() {
    return this.proxyPost('/api/crawler/captcha-resolved', {});
  }

  async getRecords(filter = 'all') {
    return this.proxyGet('/api/records', { params: { filter } });
  }

  async getPhones() {
    return this.proxyGet('/api/phones');
  }

  async getPriceSources() {
    return this.proxyGet('/api/price/sources');
  }

  async savePriceSources(
    sources: Array<{ id: string; label?: string; enabled?: boolean }>,
    priceSearchCity?: string,
  ) {
    const body: Record<string, unknown> = { sources };
    if (priceSearchCity) {
      body.price_search_city = priceSearchCity;
    }
    return this.proxyPut('/api/price/sources', body);
  }

  async searchPrices(query: string, city?: string) {
    const body: Record<string, string> = { query };
    if (city) {
      body.city = city;
    }
    return this.proxyPost('/api/price/search', body, 120_000);
  }

  async previewPriceQuery(query: string) {
    return this.proxyPost<{
      ok: boolean;
      original: string;
      corrected: string;
      search_query: string;
      spelling_corrections: string[];
    }>('/api/price/preview', { query });
  }

  async streamPhonesExport(res: Response) {
    try {
      const response = await axios.get(`${this.baseUrl}/api/export/phones.txt`, {
        responseType: 'stream',
        timeout: 60_000,
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        throw this.toHttpException(response.status, response.data);
      }
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="phones.txt"');
      response.data.pipe(res);
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async proxyGet<T>(path: string, config: AxiosRequestConfig = {}): Promise<T> {
    try {
      const response = await axios.get<T>(`${this.baseUrl}${path}`, {
        timeout: 60_000,
        validateStatus: () => true,
        ...config,
      });
      if (response.status >= 400) {
        throw this.toHttpException(response.status, response.data);
      }
      return response.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async proxyPost<T>(path: string, body: unknown, timeout = 120_000): Promise<T> {
    try {
      const response = await axios.post<T>(`${this.baseUrl}${path}`, body, {
        timeout,
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        throw this.toHttpException(response.status, response.data);
      }
      return response.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private async proxyPut<T>(path: string, body: unknown): Promise<T> {
    try {
      const response = await axios.put<T>(`${this.baseUrl}${path}`, body, {
        timeout: 30_000,
        validateStatus: () => true,
      });
      if (response.status >= 400) {
        throw this.toHttpException(response.status, response.data);
      }
      return response.data;
    } catch (err) {
      throw this.wrapError(err);
    }
  }

  private toHttpException(status: number, data: unknown): Error {
    const detail = this.extractDetail(data);
    const message = detail || `Crawler service error (${status})`;
    if (status === 503 || status === 502) {
      return new ServiceUnavailableException(message);
    }
    if (status === 409) {
      return new ConflictException(message);
    }
    const err = new BadGatewayException(message);
    (err as any).status = status;
    return err;
  }

  private extractDetail(data: unknown): string | undefined {
    if (!data) return undefined;
    if (typeof data === 'string') return data;
    if (typeof data === 'object' && data !== null) {
      const obj = data as Record<string, unknown>;
      if (typeof obj.detail === 'string') return obj.detail;
      if (typeof obj.message === 'string') return obj.message;
    }
    return undefined;
  }

  private wrapError(err: unknown): Error {
    if (err instanceof BadGatewayException || err instanceof ServiceUnavailableException) {
      return err;
    }
    const ax = err as AxiosError;
    if (ax?.code === 'ECONNREFUSED' || ax?.code === 'ENOTFOUND') {
      this.logger.warn(`Crawler service unreachable at ${this.baseUrl}`);
      return new ServiceUnavailableException(
        `سرویس خزشگر در دسترس نیست (${this.baseUrl}) — کانتینر crawler را بررسی کنید: docker compose ps crawler && docker compose logs --tail=50 crawler`,
      );
    }
    if (ax?.response) {
      return this.toHttpException(ax.response.status, ax.response.data);
    }
    this.logger.error('Crawler proxy error', err instanceof Error ? err.stack : String(err));
    return new BadGatewayException('خطا در ارتباط با سرویس خزشگر');
  }
}
