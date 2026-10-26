import { Injectable, Logger } from '@nestjs/common';
import { google, searchconsole_v1 } from 'googleapis';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';

export type GscRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

@Injectable()
export class GscClientService {
  private readonly logger = new Logger(GscClientService.name);

  constructor(private readonly secrets: ServerSecretConfigService) {}

  getConfiguredSiteUrl(): string {
    return (this.secrets.getOptional('GSC_SITE_URL') || '').trim();
  }

  hasCredentials(): boolean {
    const json = (this.secrets.getOptional('GSC_SERVICE_ACCOUNT_JSON') || '').trim();
    return json.length > 10 && this.getConfiguredSiteUrl().length > 0;
  }

  private async getAuthClient() {
    const raw = (this.secrets.getOptional('GSC_SERVICE_ACCOUNT_JSON') || '').trim();
    if (!raw) {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON تنظیم نشده است');
    }
    let credentials: Record<string, unknown>;
    try {
      credentials = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('GSC_SERVICE_ACCOUNT_JSON معتبر نیست (JSON خراب)');
    }
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    return auth.getClient();
  }

  private async getSearchConsole(): Promise<searchconsole_v1.Searchconsole> {
    const auth = await this.getAuthClient();
    return google.searchconsole({ version: 'v1', auth: auth as never });
  }

  async verifyAccess(): Promise<{ ok: boolean; siteUrl: string; sites: string[] }> {
    const siteUrl = this.getConfiguredSiteUrl();
    if (!siteUrl) {
      throw new Error('GSC_SITE_URL تنظیم نشده است');
    }
    const sc = await this.getSearchConsole();
    const list = await sc.sites.list();
    const sites = (list.data.siteEntry || [])
      .map((s) => s.siteUrl || '')
      .filter(Boolean);
    const ok = sites.some(
      (s) => s === siteUrl || s.replace(/\/$/, '') === siteUrl.replace(/\/$/, ''),
    );
    return { ok, siteUrl, sites };
  }

  async querySearchAnalytics(opts: {
    startDate: string;
    endDate: string;
    dimensions: string[];
    startRow?: number;
    rowLimit?: number;
  }): Promise<GscRow[]> {
    const siteUrl = this.getConfiguredSiteUrl();
    if (!siteUrl) throw new Error('GSC_SITE_URL تنظیم نشده است');

    const sc = await this.getSearchConsole();
    const res = await sc.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: opts.startDate,
        endDate: opts.endDate,
        dimensions: opts.dimensions,
        startRow: opts.startRow ?? 0,
        rowLimit: opts.rowLimit ?? 25000,
      },
    });

    return (res.data.rows || []).map((r) => ({
      keys: r.keys || [],
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
      ctr: r.ctr || 0,
      position: r.position || 0,
    }));
  }

  async queryAll(opts: {
    startDate: string;
    endDate: string;
    dimensions: string[];
  }): Promise<GscRow[]> {
    const all: GscRow[] = [];
    let startRow = 0;
    const rowLimit = 25000;
    for (;;) {
      const chunk = await this.querySearchAnalytics({
        ...opts,
        startRow,
        rowLimit,
      });
      all.push(...chunk);
      if (chunk.length < rowLimit) break;
      startRow += rowLimit;
      if (startRow > 200_000) {
        this.logger.warn('GSC pagination safety stop at 200k rows');
        break;
      }
    }
    return all;
  }
}
