import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SiteAnalyticsRollupService } from '../services/site-analytics-rollup.service';
import { GscSyncService } from '../services/gsc-sync.service';
import { GscClientService } from '../services/gsc-client.service';

@Injectable()
export class SiteAnalyticsScheduler {
  private readonly logger = new Logger(SiteAnalyticsScheduler.name);

  constructor(
    private readonly rollup: SiteAnalyticsRollupService,
    private readonly gscSync: GscSyncService,
    private readonly gscClient: GscClientService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_1AM)
  async nightlySiteRollup() {
    try {
      await this.rollup.rollupYesterday();
      await this.rollup.rollupToday();
      await this.rollup.purgeOldRaw();
    } catch (err) {
      this.logger.error(
        `Site rollup failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async nightlyGscSync() {
    if (!this.gscClient.hasCredentials()) {
      return;
    }
    try {
      await this.gscSync.ensureInitialBackfill();
    } catch (err) {
      this.logger.error(
        `GSC sync failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /** Keep today near-live during business hours */
  @Cron(CronExpression.EVERY_HOUR)
  async hourlyTodayRollup() {
    try {
      await this.rollup.rollupToday();
    } catch (err) {
      this.logger.warn(`Hourly rollup failed: ${(err as Error).message}`);
    }
  }
}
