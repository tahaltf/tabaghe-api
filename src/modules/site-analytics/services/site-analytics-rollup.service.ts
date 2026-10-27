import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

const RAW_RETENTION_DAYS = 90;
/** ایران بدون DST؛ مرز روز برای آمار سایت */
const TEHRAN_OFFSET = '+03:30';

@Injectable()
export class SiteAnalyticsRollupService {
  private readonly logger = new Logger(SiteAnalyticsRollupService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** کلید تاریخ تقویمی (YYYY-MM-DD) به‌صورت midnight UTC برای ستون @db.Date */
  calendarDateKey(y: number, m: number, d: number): Date {
    return new Date(Date.UTC(y, m - 1, d));
  }

  /** شروع روز به وقت تهران برای یک کلید تقویمی */
  tehranDayStart(dateKey: Date): Date {
    const y = dateKey.getUTCFullYear();
    const m = String(dateKey.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dateKey.getUTCDate()).padStart(2, '0');
    return new Date(`${y}-${m}-${d}T00:00:00${TEHRAN_OFFSET}`);
  }

  tehranDayEndExclusive(dateKey: Date): Date {
    const start = this.tehranDayStart(dateKey);
    const end = new Date(start.getTime());
    end.setTime(end.getTime() + 24 * 60 * 60 * 1000);
    return end;
  }

  /** بازه خام inclusive از/تا کلید تقویمی */
  rawRange(fromKey: Date, toKey: Date): { start: Date; endExclusive: Date } {
    return {
      start: this.tehranDayStart(fromKey),
      endExclusive: this.tehranDayEndExclusive(toKey),
    };
  }

  /** Roll up a Tehran calendar day from raw pageviews. */
  async rollupDay(dayKey: Date): Promise<void> {
    const dateKey = this.calendarDateKey(
      dayKey.getUTCFullYear(),
      dayKey.getUTCMonth() + 1,
      dayKey.getUTCDate(),
    );
    const { start, endExclusive } = this.rawRange(dateKey, dateKey);

    const pageviews = await this.prisma.sitePageView.count({
      where: { viewedAt: { gte: start, lt: endExclusive } },
    });

    const sessions = await this.prisma.sitePageView.groupBy({
      by: ['sessionId'],
      where: { viewedAt: { gte: start, lt: endExclusive } },
    });

    const visitors = await this.countUniqueVisitors(start, endExclusive);

    await this.prisma.siteDailySite.upsert({
      where: { date: dateKey },
      create: {
        date: dateKey,
        pageviews,
        sessions: sessions.length,
        users: visitors,
      },
      update: {
        pageviews,
        sessions: sessions.length,
        users: visitors,
      },
    });

    const byPath = await this.prisma.sitePageView.groupBy({
      by: ['path'],
      where: { viewedAt: { gte: start, lt: endExclusive } },
      _count: { _all: true },
    });

    for (const row of byPath) {
      const pathSessions = await this.prisma.sitePageView.groupBy({
        by: ['sessionId'],
        where: {
          path: row.path,
          viewedAt: { gte: start, lt: endExclusive },
        },
      });
      await this.prisma.siteDailyPage.upsert({
        where: {
          date_path: { date: dateKey, path: row.path },
        },
        create: {
          date: dateKey,
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
      `Rolled up site analytics for ${this.asDateOnly(dateKey)}: pv=${pageviews} visitors=${visitors}`,
    );
  }

  /**
   * بازدیدکننده یکتا در بازه:
   * کاربر لاگین‌شده با userId + مهمان با sessionId
   * یک نفر با ۴ صفحه = ۱ بازدیدکننده
   */
  async countUniqueVisitors(start: Date, endExclusive: Date): Promise<number> {
    const loggedIn = await this.prisma.sitePageView.findMany({
      where: {
        viewedAt: { gte: start, lt: endExclusive },
        userId: { not: null },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    const guests = await this.prisma.sitePageView.findMany({
      where: {
        viewedAt: { gte: start, lt: endExclusive },
        userId: null,
      },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    return loggedIn.length + guests.length;
  }

  async countDistinctSessions(start: Date, endExclusive: Date): Promise<number> {
    const rows = await this.prisma.sitePageView.groupBy({
      by: ['sessionId'],
      where: { viewedAt: { gte: start, lt: endExclusive } },
    });
    return rows.length;
  }

  async rollupYesterday(): Promise<void> {
    await this.rollupDay(this.todayTehranDateKey(-1));
  }

  async rollupToday(): Promise<void> {
    await this.rollupDay(this.todayTehranDateKey(0));
  }

  todayTehranDateKey(offsetDays = 0): Date {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const [y, m, d] = fmt.format(now).split('-').map(Number);
    const key = this.calendarDateKey(y, m, d);
    if (offsetDays !== 0) {
      key.setUTCDate(key.getUTCDate() + offsetDays);
    }
    return key;
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
    let cursor = this.calendarDateKey(
      from.getUTCFullYear(),
      from.getUTCMonth() + 1,
      from.getUTCDate(),
    );
    const end = this.calendarDateKey(
      to.getUTCFullYear(),
      to.getUTCMonth() + 1,
      to.getUTCDate(),
    );
    let days = 0;
    while (cursor <= end) {
      await this.rollupDay(cursor);
      days += 1;
      cursor = new Date(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return days;
  }

  /** @deprecated use calendar keys; kept for callers */
  startOfUtcDay(d: Date): Date {
    return this.calendarDateKey(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }

  parseDateParam(value?: string): Date | null {
    if (!value) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) return null;
    return this.calendarDateKey(+m[1], +m[2], +m[3]);
  }

  defaultRange(days = 28): { from: Date; to: Date } {
    const to = this.todayTehranDateKey(0);
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
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  dateFilter(from: Date, to: Date): Prisma.DateTimeFilter {
    return { gte: from, lte: to };
  }
}
