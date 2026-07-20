import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketingAccountStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MarketingAccountService } from './marketing-account.service';
import { MarketingInsightsService } from './marketing-insights.service';
import { MarketingPublishService } from './marketing-publish.service';

@Injectable()
export class MarketingSchedulerService {
  private readonly logger = new Logger(MarketingSchedulerService.name);
  private publishRunning = false;
  private tokenRunning = false;
  private insightsRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publish: MarketingPublishService,
    private readonly accounts: MarketingAccountService,
    private readonly insights: MarketingInsightsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processScheduledPosts() {
    if (this.publishRunning) return;
    this.publishRunning = true;
    try {
      const n = await this.publish.processDueScheduled();
      if (n > 0) {
        this.logger.log(`Published ${n} scheduled marketing post(s)`);
      }
    } catch (err) {
      this.logger.error(
        'Scheduled publish failed',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.publishRunning = false;
    }
  }

  /** Refresh tokens that expire within 7 days */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async refreshExpiringTokens() {
    if (this.tokenRunning) return;
    this.tokenRunning = true;
    try {
      const threshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const tokens = await this.prisma.marketingAccountToken.findMany({
        where: {
          OR: [
            { tokenExpiresAt: null },
            { tokenExpiresAt: { lte: threshold } },
          ],
          account: { status: { not: MarketingAccountStatus.REVOKED } },
        },
        include: { account: true },
      });

      for (const token of tokens) {
        try {
          await this.accounts.refreshAccountToken(token.accountId);
          this.logger.log(
            `Refreshed token for @${token.account.username}`,
          );
        } catch (err) {
          this.logger.warn(
            `Token refresh failed for ${token.accountId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
          await this.accounts.markTokenExpired(token.accountId);
        }
      }
    } finally {
      this.tokenRunning = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async cacheInsights() {
    if (this.insightsRunning) return;
    this.insightsRunning = true;
    try {
      const n = await this.insights.refreshAllAccountInsights();
      this.logger.log(`Cached insights for ${n} marketing account(s)`);
    } catch (err) {
      this.logger.error(
        'Insights cache failed',
        err instanceof Error ? err.stack : undefined,
      );
    } finally {
      this.insightsRunning = false;
    }
  }
}
