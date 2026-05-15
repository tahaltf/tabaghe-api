import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AdminBackupService } from './admin-backup.service';

@Injectable()
export class AdminBackupScheduler {
  private readonly logger = new Logger(AdminBackupScheduler.name);

  constructor(private readonly backup: AdminBackupService) {}

  /** هر دقیقه بررسی زمان اجرای بک‌اپ زمان‌بندی‌شده */
  @Interval(60_000)
  async tick(): Promise<void> {
    try {
      const due = await this.backup.shouldRunScheduled();
      if (!due) return;
      await this.backup.runBackup('scheduled');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Scheduled backup failed: ${msg}`);
    }
  }
}
