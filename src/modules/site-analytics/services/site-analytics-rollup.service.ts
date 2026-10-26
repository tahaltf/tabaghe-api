import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const RAW_RETENTION_DAYS = 90;

@Injectable()
export class SiteAnalyticsRollupService {
  private readonly logger = new Logger(SiteAnalyticsRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Roll up a calendar day (UTC date boundary) from raw pageviews. */
  async rollupDay(day: Date): Promise<void> {
    const start = this.startOfUtcDay(day);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);

    const pageviews = await this.prisma.sitePageView.count({
      where: { viewedAt: { gte: start, lt: end } },
    });

    const sessions = await this.prisma.sitePageView.groupBy({
      by: ['sessionId'],
      where: { viewedAt: { gte: start, lt: end } },
    });

    const loggedIn = await this.prisma.sitePageView.findMany({
      where: {
        viewedAt: { gte: start, lt: end },
        userId: { not: null },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    const guestSessions = await this.prisma.sitePageView.findMany({
      where: {
        viewedAt: { gte: start, lt: end },
        userId: null,
      },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    const users = loggedIn.length + guestSessions.length;

    await this.prisma.siteDailySite.upsert({
      where: { date: start },
      create: {
        date: start,
        pageviews,
        sessions: sessions.length,
        users,
      },
      update: {
        pageviews,
        sessions: sessions.length,
        users,
      },
    });

    const byPath = await this.prisma.sitePageView.groupBy({
      by: ['path'],
      where: { viewedAt: { gte: start, lt: end } },
      _count: { _all: true },
    });

    for (const row of byPath) {
      const pathSessions = await this.prisma.sitePageView.groupBy({
        by: ['sessionId'],
        where: {
          path: row.path,
          viewedAt: { gte: start, lt: end },
        },
      });
      await this.prisma.siteDailyPage.upsert({
        where: {
          date_path: { date: start, path: row.path },
        },
        create: {
          date: start,
          path: row.path,
          pageviews: row._count._all,
          sessions: pathSessions.length,
        },
        update: {
          pageviews: row._count._all,
          sessions: pathSessions.length,
        },
      });
    }

    this.logger.log(
      `Rolled up site analytics for ${start.toISOString().slice(0, 10)}: pv=${pageviews} sessions=${sessions.length}`,
    );
  }

  async rollupYesterday(): Promise<void> {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    await this.rollupDay(yesterday);
  }

  /** Also refresh today so admin UI is near-live. */
  async rollupToday(): Promise<void> {
    await this.rollupDay(new Date());
  }

  async purgeOldRaw(): Promise<number> {
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - RAW_RETENTION_DAYS);
    const result = await this.prisma.sitePageView.deleteMany({
      where: { viewedAt: { lt: cutoff } },
    });
    if (result.count > 0) {
      this.logger.log(`Purged ${result.count} raw pageviews older than ${RAW_RETENTION_DAYS}d`);
    }
    return result.count;
  }

  async rollupRange(from: Date, to: Date): Promise<number> {
    let cursor = this.startOfUtcDay(from);
    const end = this.startOfUtcDay(to);
    let days = 0;
    while (cursor <= end) {
      await this.rollupDay(cursor);
      days += 1;
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  startOfUtcDay(d: Date): Date {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  parseDateParam(value?: string): Date | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  }

  defaultRange(days = 28): { from: Date; to: Date } {
    const to = this.startOfUtcDay(new Date());
    const from = new Date(to);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    return { from, to };
  }

  previousRange(from: Date, to: Date): { from: Date; to: Date } {
    const ms = to.getTime() - from.getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const lenDays = Math.round(ms / dayMs) + 1;
    const prevTo = new Date(from);
    prevTo.setUTCDate(prevTo.getUTCDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setUTCDate(prevFrom.getUTCDate() - (lenDays - 1));
    return { from: prevFrom, to: prevTo };
  }

  asDateOnly(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /** Prisma Date filter helper for @db.Date columns stored as midnight UTC */
  dateFilter(from: Date, to: Date): Prisma.DateTimeFilter {
    return { gte: from, lte: to };
  }
}
