import { Injectable, Logger } from '@nestjs/common';
import { GscPropertyStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { GscClientService } from './gsc-client.service';
import { SiteAnalyticsRollupService } from './site-analytics-rollup.service';

@Injectable()
export class GscSyncService {
  private readonly logger = new Logger(GscSyncService.name);
  private syncing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gsc: GscClientService,
    private readonly rollup: SiteAnalyticsRollupService,
  ) {}

  async getStatus() {
    const siteUrl = this.gsc.getConfiguredSiteUrl();
    const hasCredentials = this.gsc.hasCredentials();
    const property = await this.prisma.gscProperty.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
    return {
      hasCredentials,
      configuredSiteUrl: siteUrl || null,
      property: property
        ? {
            siteUrl: property.siteUrl,
            status: property.status,
            lastSyncAt: property.lastSyncAt,
            lastError: property.lastError,
          }
        : null,
      syncing: this.syncing,
      dataLagNote:
        'داده Search Console معمولاً ۲ تا ۳ روز تأخیر دارد.',
    };
  }

  async verifyAndConnect() {
    const result = await this.gsc.verifyAccess();
    const siteUrl = result.siteUrl;
    const status = result.ok
      ? GscPropertyStatus.CONNECTED
      : GscPropertyStatus.ERROR;
    const lastError = result.ok
      ? null
      : `Property در لیست دسترسی Service Account نیست. سایت‌های موجود: ${result.sites.join(', ') || '—'}`;

    await this.prisma.gscProperty.upsert({
      where: { siteUrl },
      create: { siteUrl, status, lastError },
      update: { status, lastError },
    });

    return { ...result, status, lastError };
  }

  async syncRecent(days = 28): Promise<{ days: number; ok: boolean }> {
    if (this.syncing) {
      return { days: 0, ok: false };
    }
    this.syncing = true;
    const siteUrl = this.gsc.getConfiguredSiteUrl();
    try {
      if (!this.gsc.hasCredentials()) {
        throw new Error('اعتبارنامه GSC تنظیم نشده است');
      }

      const end = new Date();
      end.setUTCDate(end.getUTCDate() - 2); // GSC lag
      const start = new Date(end);
      start.setUTCDate(start.getUTCDate() - (days - 1));

      const startDate = this.rollup.asDateOnly(this.rollup.startOfUtcDay(start));
      const endDate = this.rollup.asDateOnly(this.rollup.startOfUtcDay(end));

      await this.syncRange(startDate, endDate);

      await this.prisma.gscProperty.upsert({
        where: { siteUrl },
        create: {
          siteUrl,
          status: GscPropertyStatus.CONNECTED,
          lastSyncAt: new Date(),
          lastError: null,
        },
        update: {
          status: GscPropertyStatus.CONNECTED,
          lastSyncAt: new Date(),
          lastError: null,
        },
      });

      return { days, ok: true };
    } catch (err) {
      const message = (err as Error).message || 'خطای ناشناخته sync';
      this.logger.error(`GSC sync failed: ${message}`);
      if (siteUrl) {
        await this.prisma.gscProperty.upsert({
          where: { siteUrl },
          create: {
            siteUrl,
            status: GscPropertyStatus.ERROR,
            lastError: message,
          },
          update: {
            status: GscPropertyStatus.ERROR,
            lastError: message,
          },
        });
      }
      throw err;
    } finally {
      this.syncing = false;
    }
  }

  async syncRange(startDate: string, endDate: string): Promise<void> {
    this.logger.log(`GSC sync ${startDate} → ${endDate}`);

    const siteRows = await this.gsc.queryAll({
      startDate,
      endDate,
      dimensions: ['date'],
    });
    for (const row of siteRows) {
      const date = this.rollup.parseDateParam(row.keys[0]);
      if (!date) continue;
      await this.prisma.gscDailySite.upsert({
        where: { date },
        create: {
          date,
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
        update: {
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
      });
    }

    const pageRows = await this.gsc.queryAll({
      startDate,
      endDate,
      dimensions: ['date', 'page'],
    });
    for (const row of pageRows) {
      const date = this.rollup.parseDateParam(row.keys[0]);
      const page = row.keys[1];
      if (!date || !page) continue;
      await this.prisma.gscDailyPage.upsert({
        where: { date_page: { date, page } },
        create: {
          date,
          page,
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
        update: {
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
      });
    }

    const queryRows = await this.gsc.queryAll({
      startDate,
      endDate,
      dimensions: ['date', 'query'],
    });
    for (const row of queryRows) {
      const date = this.rollup.parseDateParam(row.keys[0]);
      const query = row.keys[1];
      if (!date || !query) continue;
      await this.prisma.gscDailyQuery.upsert({
        where: { date_query: { date, query } },
        create: {
          date,
          query,
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
        update: {
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
      });
    }

    // Page+query for drill-down (can be heavy — cap via pagination safety in client)
    const pageQueryRows = await this.gsc.queryAll({
      startDate,
      endDate,
      dimensions: ['date', 'page', 'query'],
    });
    for (const row of pageQueryRows) {
      const date = this.rollup.parseDateParam(row.keys[0]);
      const page = row.keys[1];
      const query = row.keys[2];
      if (!date || !page || !query) continue;
      await this.prisma.gscDailyPageQuery.upsert({
        where: { date_page_query: { date, page, query } },
        create: {
          date,
          page,
          query,
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
        update: {
          clicks: Math.round(row.clicks),
          impressions: Math.round(row.impressions),
          ctr: row.ctr,
          position: row.position,
        },
      });
    }

    this.logger.log(
      `GSC sync done: site=${siteRows.length} pages=${pageRows.length} queries=${queryRows.length} pageQueries=${pageQueryRows.length}`,
    );
  }

  async ensureInitialBackfill(): Promise<void> {
    const count = await this.prisma.gscDailySite.count();
    if (count > 0) {
      await this.syncRecent(28);
      return;
    }
    await this.syncRecent(90);
  }
}
