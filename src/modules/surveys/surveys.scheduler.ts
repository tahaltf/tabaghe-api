import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SurveysService } from './surveys.service';

@Injectable()
export class SurveysScheduler {
  private readonly logger = new Logger(SurveysScheduler.name);
  private running = false;

  constructor(private readonly surveys: SurveysService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async sendDueSurveys(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const sent = await this.surveys.processDueSends();
      if (sent > 0) {
        this.logger.log(`Sent ${sent} post-purchase survey invite(s)`);
      }
    } catch (err) {
      this.logger.warn(
        `Survey send cron failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      this.running = false;
    }
  }
}
