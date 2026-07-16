import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlanLifecycleService } from './plan-lifecycle.service';

@Injectable()
export class PlanExpiryScheduler {
  private readonly logger = new Logger(PlanExpiryScheduler.name);
  private running = false;

  constructor(private readonly planLifecycle: PlanLifecycleService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.planLifecycle.processExpiredPlans();
      if (result.expired > 0) {
        this.logger.log(
          `Plan expiry: cancelled=${result.expired}, notified=${result.notified}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Plan expiry cron failed: ${String((err as Error)?.message ?? err)}`,
      );
    } finally {
      this.running = false;
    }
  }
}
