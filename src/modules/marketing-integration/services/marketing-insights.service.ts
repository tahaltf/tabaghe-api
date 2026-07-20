import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { InstagramProvider } from '../providers/instagram/instagram.provider';
import { MarketingAccountService } from './marketing-account.service';

@Injectable()
export class MarketingInsightsService {
  private readonly logger = new Logger(MarketingInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: MarketingAccountService,
    private readonly instagram: InstagramProvider,
  ) {}

  async getOverview(accountId?: string) {
    const accounts = accountId
      ? [await this.accounts.getAccountOrThrow(accountId)]
      : await this.prisma.marketingAccount.findMany();

    const results = [];
    for (const account of accounts) {
      const snapshots = await this.prisma.marketingInsightSnapshot.findMany({
        where: {
          accountId: account.id,
          capturedAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
        orderBy: { capturedAt: 'desc' },
        take: 50,
      });

      const latestByMetric = new Map<string, { value: number; capturedAt: Date }>();
      for (const s of snapshots) {
        if (!latestByMetric.has(s.metricKey)) {
          latestByMetric.set(s.metricKey, {
            value: s.value,
            capturedAt: s.capturedAt,
          });
        }
      }

      const postStats = await this.prisma.marketingPost.groupBy({
        by: ['status'],
        where: { accountId: account.id },
        _count: true,
      });

      results.push({
        account: {
          id: account.id,
          username: account.username,
          platform: account.platform,
          profilePicture: account.profilePicture,
          status: account.status,
        },
        metrics: Array.from(latestByMetric.entries()).map(([key, v]) => ({
          metricKey: key,
          value: v.value,
          capturedAt: v.capturedAt,
        })),
        postsByStatus: postStats.map((p) => ({
          status: p.status,
          count: p._count,
        })),
        conversationCount: await this.prisma.marketingConversation.count({
          where: { accountId: account.id },
        }),
      });
    }

    return { accounts: results };
  }

  async getMediaInsights(accountId: string, platformMediaId: string) {
    const { accessToken } = await this.accounts.getDecryptedToken(accountId);
    return this.instagram.getMediaInsights(accessToken, platformMediaId);
  }

  async refreshAllAccountInsights(): Promise<number> {
    const accounts = await this.prisma.marketingAccount.findMany({
      where: { status: 'ACTIVE' },
    });
    let count = 0;
    for (const account of accounts) {
      try {
        const { accessToken, externalId } =
          await this.accounts.getDecryptedToken(account.id);
        const metrics = await this.instagram.getAccountInsights(
          accessToken,
          externalId,
        );
        for (const m of metrics) {
          await this.prisma.marketingInsightSnapshot.create({
            data: {
              accountId: account.id,
              metricKey: m.metricKey,
              value: m.value,
              period: m.period || 'day',
            },
          });
        }
        count += 1;
      } catch (err) {
        this.logger.warn(
          `Insights refresh failed for ${account.username}: ${
            err instanceof Error ? err.message : err
          }`,
        );
      }
    }
    return count;
  }
}
