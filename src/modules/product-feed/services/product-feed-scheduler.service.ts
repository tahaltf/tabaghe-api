import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ProductFeedSyncService } from './product-feed-sync.service';

@Injectable()
export class ProductFeedSchedulerService {
  private readonly logger = new Logger(ProductFeedSchedulerService.name);
  private running = false;

  constructor(private readonly sync: ProductFeedSyncService) {}

  /** هر ۱۵ دقیقه فیدهای فعال را همگام می‌کند */
  @Cron('*/15 * * * *')
  async syncEnabledFeeds() {
    if (this.running) return;
    this.running = true;
    try {
      const n = await this.sync.syncAllEnabledFeeds();
      if (n > 0) {
        this.logger.log(`Synced ${n} external product feed(s)`);
      }
    } catch (err) {
      this.logger.error(
        'Product feed scheduled sync failed',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.running = false;
    }
  }
}
