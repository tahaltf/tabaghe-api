import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SiteAnalyticsRollupService } from './site-analytics-rollup.service';

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

const LISTING_PATH_RE = /^\/listing\/([^/?#]+)/i;

@Injectable()
export class SiteAnalyticsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rollup: SiteAnalyticsRollupService,
  ) {}

  resolveRange(fromStr?: string, toStr?: string) {
    const parsedFrom = this.rollup.parseDateParam(fromStr);
    const parsedTo = this.rollup.parseDateParam(toStr);
    if (parsedFrom && parsedTo && parsedFrom <= parsedTo) {
      return { from: parsedFrom, to: parsedTo };
    }
    return this.rollup.defaultRange(28);
  }

  /**
   * آمار واقعی سایت — بدون Search Console.
   * visitors یکتای بازه از داده خام (نه جمع روزانه).
   */
  async getOverview(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const prev = this.rollup.previousRange(from, to);
    const { start, endExclusive } = this.rollup.rawRange(from, to);
    const prevRaw = this.rollup.rawRange(prev.from, prev.to);

    const [
      pageviews,
      visitors,
      sessions,
      prevPageviews,
      prevVisitors,
      prevSessions,
      topPagesRaw,
      listingPaths,
    ] = await Promise.all([
      this.prisma.sitePageView.count({
        where: { viewedAt: { gte: start, lt: endExclusive } },
      }),
      this.rollup.countUniqueVisitors(start, endExclusive),
      this.rollup.countDistinctSessions(start, endExclusive),
      this.prisma.sitePageView.count({
        where: {
          viewedAt: { gte: prevRaw.start, lt: prevRaw.endExclusive },
        },
      }),
      this.rollup.countUniqueVisitors(prevRaw.start, prevRaw.endExclusive),
      this.rollup.countDistinctSessions(prevRaw.start, prevRaw.endExclusive),
      this.prisma.sitePageView.groupBy({
        by: ['path'],
        where: { viewedAt: { gte: start, lt: endExclusive } },
        _count: { _all: true },
      }),
      this.prisma.sitePageView.groupBy({
        by: ['path'],
        where: {
          viewedAt: { gte: start, lt: endExclusive },
          path: { startsWith: '/listing/' },
        },
        _count: { _all: true },
      }),
    ]);

    const topPagesSorted = [...topPagesRaw]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 15)
      .map((p) => ({ path: p.path, pageviews: p._count._all }));

    const listingSorted = [...listingPaths]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 20)
      .map((p) => ({ path: p.path, pageviews: p._count._all }));

    const topPages = await this.enrichPagesWithVisitors(
      topPagesSorted,
      start,
      endExclusive,
    );

    const topListings = await this.enrichListings(
      listingSorted,
      start,
      endExclusive,
    );

    const uniquePages = await this.prisma.sitePageView.groupBy({
      by: ['path'],
      where: { viewedAt: { gte: start, lt: endExclusive } },
    });

    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      previousFrom: this.rollup.asDateOnly(prev.from),
      previousTo: this.rollup.asDateOnly(prev.to),
      source: 'first_party' as const,
      site: {
        pageviews,
        visitors,
        sessions,
        uniquePages: uniquePages.length,
        pagesPerVisitor:
          visitors > 0 ? Math.round((pageviews / visitors) * 100) / 100 : 0,
        pagesPerSession:
          sessions > 0 ? Math.round((pageviews / sessions) * 100) / 100 : 0,
        deltas: {
          pageviews: deltaPct(pageviews, prevPageviews),
          visitors: deltaPct(visitors, prevVisitors),
          sessions: deltaPct(sessions, prevSessions),
        },
      },
      topPages,
      topListings,
    };
  }

  async getSiteTimeseries(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    // اطمینان از به‌روز بودن امروز
    await this.rollup.rollupToday().catch(() => undefined);

    const rows = await this.prisma.siteDailySite.findMany({
      where: { date: this.rollup.dateFilter(from, to) },
      orderBy: { date: 'asc' },
    });

    // اگر رول‌آپ خالی بود، از خام بساز برای نمایش
    if (!rows.length) {
      const points: Array<{
        date: string;
        pageviews: number;
        sessions: number;
        visitors: number;
      }> = [];
      let cursor = new Date(from);
      while (cursor <= to) {
        const { start, endExclusive } = this.rollup.rawRange(cursor, cursor);
        const [pageviews, sessions, visitors] = await Promise.all([
          this.prisma.sitePageView.count({
            where: { viewedAt: { gte: start, lt: endExclusive } },
          }),
          this.rollup.countDistinctSessions(start, endExclusive),
          this.rollup.countUniqueVisitors(start, endExclusive),
        ]);
        points.push({
          date: this.rollup.asDateOnly(cursor),
          pageviews,
          sessions,
          visitors,
        });
        cursor = new Date(cursor);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return {
        from: this.rollup.asDateOnly(from),
        to: this.rollup.asDateOnly(to),
        points,
      };
    }

    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      points: rows.map((r) => ({
        date: this.rollup.asDateOnly(r.date),
        pageviews: r.pageviews,
        sessions: r.sessions,
        visitors: r.users,
      })),
    };
  }

  async getSitePages(opts: {
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
    sortDir?: string;
    limit?: number;
  }) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const { start, endExclusive } = this.rollup.rawRange(from, to);

    const grouped = await this.prisma.sitePageView.groupBy({
      by: ['path'],
      where: {
        viewedAt: { gte: start, lt: endExclusive },
        ...(opts.q
          ? { path: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      _count: { _all: true },
    });

    const enriched = await this.enrichPagesWithVisitors(
      grouped.map((g) => ({ path: g.path, pageviews: g._count._all })),
      start,
      endExclusive,
    );

    const sortKey = opts.sort === 'visitors' ? 'visitors' : 'pageviews';
    const dir = opts.sortDir === 'asc' ? 1 : -1;
    enriched.sort((a, b) => (a[sortKey] - b[sortKey]) * dir);

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      items: enriched.slice(0, limit),
      total: enriched.length,
    };
  }

  async getSiteListings(opts: {
    from?: string;
    to?: string;
    q?: string;
    limit?: number;
  }) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const { start, endExclusive } = this.rollup.rawRange(from, to);

    const grouped = await this.prisma.sitePageView.groupBy({
      by: ['path'],
      where: {
        viewedAt: { gte: start, lt: endExclusive },
        path: { startsWith: '/listing/' },
        ...(opts.q
          ? { path: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      _count: { _all: true },
    });

    const items = await this.enrichListings(
      grouped.map((g) => ({ path: g.path, pageviews: g._count._all })),
      start,
      endExclusive,
    );
    items.sort((a, b) => b.pageviews - a.pageviews);

    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      items: items.slice(0, limit),
      total: items.length,
    };
  }

  private async enrichPagesWithVisitors(
    rows: Array<{ path: string; pageviews: number }>,
    start: Date,
    endExclusive: Date,
  ) {
    const result: Array<{
      path: string;
      pageviews: number;
      visitors: number;
    }> = [];
    for (const row of rows) {
      const visitors = await this.countPathVisitors(row.path, start, endExclusive);
      result.push({ ...row, visitors });
    }
    return result;
  }

  private async countPathVisitors(
    path: string,
    start: Date,
    endExclusive: Date,
  ): Promise<number> {
    const loggedIn = await this.prisma.sitePageView.findMany({
      where: {
        path,
        viewedAt: { gte: start, lt: endExclusive },
        userId: { not: null },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    const guests = await this.prisma.sitePageView.findMany({
      where: {
        path,
        viewedAt: { gte: start, lt: endExclusive },
        userId: null,
      },
      distinct: ['sessionId'],
      select: { sessionId: true },
    });
    return loggedIn.length + guests.length;
  }

  private async enrichListings(
    rows: Array<{ path: string; pageviews: number }>,
    start: Date,
    endExclusive: Date,
  ) {
    const ids = rows
      .map((r) => LISTING_PATH_RE.exec(r.path)?.[1])
      .filter((id): id is string => !!id);

    const listings = ids.length
      ? await this.prisma.listing.findMany({
          where: { id: { in: ids } },
          select: {
            id: true,
            title: true,
            thumbnail: true,
            status: true,
          },
        })
      : [];
    const map = new Map(listings.map((l) => [l.id, l]));

    const result = [];
    for (const row of rows) {
      const id = LISTING_PATH_RE.exec(row.path)?.[1] ?? null;
      const visitors = await this.countPathVisitors(row.path, start, endExclusive);
      const listing = id ? map.get(id) ?? null : null;
      result.push({
        path: row.path,
        listingId: id,
        title: listing?.title ?? null,
        thumbnail: listing?.thumbnail ?? null,
        status: listing?.status ?? null,
        pageviews: row.pageviews,
        visitors,
      });
    }
    return result;
  }

  // ——— GSC (جدا از ترافیک سایت) ———

  async getGscOverview(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const prev = this.rollup.previousRange(from, to);
    const dateFilter = this.rollup.dateFilter(from, to);
    const prevFilter = this.rollup.dateFilter(prev.from, prev.to);

    const [gscRows, prevGscRows, property] = await Promise.all([
      this.prisma.gscDailySite.findMany({ where: { date: dateFilter } }),
      this.prisma.gscDailySite.findMany({ where: { date: prevFilter } }),
      this.prisma.gscProperty.findFirst({ orderBy: { updatedAt: 'desc' } }),
    ]);

    const sumGsc = (rows: typeof gscRows) => {
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      const impressions = rows.reduce((a, r) => a + r.impressions, 0);
      const positionSum = rows.reduce(
        (a, r) => a + r.position * r.impressions,
        0,
      );
      return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? positionSum / impressions : 0,
      };
    };

    const gsc = sumGsc(gscRows);
    const gscPrev = sumGsc(prevGscRows);

    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      source: 'search_console' as const,
      clicks: gsc.clicks,
      impressions: gsc.impressions,
      ctr: Math.round(gsc.ctr * 10000) / 100,
      position: Math.round(gsc.position * 10) / 10,
      deltas: {
        clicks: deltaPct(gsc.clicks, gscPrev.clicks),
        impressions: deltaPct(gsc.impressions, gscPrev.impressions),
      },
      property: property
        ? {
            siteUrl: property.siteUrl,
            status: property.status,
            lastSyncAt: property.lastSyncAt,
            lastError: property.lastError,
          }
        : null,
      dataLagNote: 'داده Search Console معمولاً ۲ تا ۳ روز تأخیر دارد.',
    };
  }

  async getGscTimeseries(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const rows = await this.prisma.gscDailySite.findMany({
      where: { date: this.rollup.dateFilter(from, to) },
      orderBy: { date: 'asc' },
    });
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      points: rows.map((r) => ({
        date: this.rollup.asDateOnly(r.date),
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Math.round(r.ctr * 10000) / 100,
        position: Math.round(r.position * 10) / 10,
      })),
    };
  }

  async getGscPages(opts: {
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
    sortDir?: string;
    limit?: number;
  }) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const grouped = await this.prisma.gscDailyPage.groupBy({
      by: ['page'],
      where: {
        date: this.rollup.dateFilter(from, to),
        ...(opts.q
          ? { page: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      _sum: { clicks: true, impressions: true },
      _avg: { position: true },
    });

    const sortKey = opts.sort || 'clicks';
    const dir = opts.sortDir === 'asc' ? 1 : -1;
    const rows = grouped
      .map((g) => {
        const clicks = g._sum.clicks ?? 0;
        const impressions = g._sum.impressions ?? 0;
        return {
          page: g.page,
          clicks,
          impressions,
          ctr:
            impressions > 0
              ? Math.round((clicks / impressions) * 10000) / 100
              : 0,
          position: Math.round((g._avg.position ?? 0) * 10) / 10,
        };
      })
      .sort((a, b) => {
        const pick = (row: typeof a) => {
          if (sortKey === 'impressions') return row.impressions;
          if (sortKey === 'ctr') return row.ctr;
          if (sortKey === 'position') return row.position;
          return row.clicks;
        };
        return (pick(a) - pick(b)) * dir;
      });

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      items: rows.slice(0, limit),
      total: rows.length,
    };
  }

  async getGscQueries(opts: {
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
    sortDir?: string;
    limit?: number;
  }) {
    const { from, to } = this.resolveRange(opts.from, opts.to);
    const grouped = await this.prisma.gscDailyQuery.groupBy({
      by: ['query'],
      where: {
        date: this.rollup.dateFilter(from, to),
        ...(opts.q
          ? { query: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      _sum: { clicks: true, impressions: true },
      _avg: { position: true },
    });

    const sortKey = opts.sort || 'clicks';
    const dir = opts.sortDir === 'asc' ? 1 : -1;
    const rows = grouped
      .map((g) => {
        const clicks = g._sum.clicks ?? 0;
        const impressions = g._sum.impressions ?? 0;
        return {
          query: g.query,
          clicks,
          impressions,
          ctr:
            impressions > 0
              ? Math.round((clicks / impressions) * 10000) / 100
              : 0,
          position: Math.round((g._avg.position ?? 0) * 10) / 10,
        };
      })
      .sort((a, b) => {
        const pick = (row: typeof a) => {
          if (sortKey === 'impressions') return row.impressions;
          if (sortKey === 'ctr') return row.ctr;
          if (sortKey === 'position') return row.position;
          return row.clicks;
        };
        return (pick(a) - pick(b)) * dir;
      });

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      items: rows.slice(0, limit),
      total: rows.length,
    };
  }

  async getPathDetail(path: string, fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const { start, endExclusive } = this.rollup.rawRange(from, to);
    const dateFilter = this.rollup.dateFilter(from, to);

    const [siteSeries, pageviews, visitors, gscSeries, queries] =
      await Promise.all([
        this.prisma.siteDailyPage.findMany({
          where: { path, date: dateFilter },
          orderBy: { date: 'asc' },
        }),
        this.prisma.sitePageView.count({
          where: { path, viewedAt: { gte: start, lt: endExclusive } },
        }),
        this.countPathVisitors(path, start, endExclusive),
        this.prisma.gscDailyPage.findMany({
          where: {
            date: dateFilter,
            OR: [{ page: path }, { page: { endsWith: path } }],
          },
          orderBy: { date: 'asc' },
        }),
        this.prisma.gscDailyPageQuery.groupBy({
          by: ['query'],
          where: {
            date: dateFilter,
            OR: [{ page: path }, { page: { endsWith: path } }],
          },
          _sum: { clicks: true, impressions: true },
          _avg: { position: true },
          orderBy: { _sum: { clicks: 'desc' } },
          take: 50,
        }),
      ]);

    return {
      path,
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      pageviews,
      visitors,
      site: siteSeries.map((r) => ({
        date: this.rollup.asDateOnly(r.date),
        pageviews: r.pageviews,
        sessions: r.sessions,
      })),
      gsc: gscSeries.map((r) => ({
        date: this.rollup.asDateOnly(r.date),
        page: r.page,
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: Math.round(r.ctr * 10000) / 100,
        position: Math.round(r.position * 10) / 10,
      })),
      queries: queries.map((q) => ({
        query: q.query,
        clicks: q._sum.clicks ?? 0,
        impressions: q._sum.impressions ?? 0,
        position: Math.round((q._avg.position ?? 0) * 10) / 10,
      })),
    };
  }
}
