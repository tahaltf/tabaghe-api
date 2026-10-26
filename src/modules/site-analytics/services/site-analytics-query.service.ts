import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SiteAnalyticsRollupService } from './site-analytics-rollup.service';

function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

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

  async getOverview(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const prev = this.rollup.previousRange(from, to);
    const dateFilter = this.rollup.dateFilter(from, to);
    const prevFilter = this.rollup.dateFilter(prev.from, prev.to);

    const [siteRows, prevSiteRows, gscRows, prevGscRows, topPages, property] =
      await Promise.all([
        this.prisma.siteDailySite.findMany({ where: { date: dateFilter } }),
        this.prisma.siteDailySite.findMany({ where: { date: prevFilter } }),
        this.prisma.gscDailySite.findMany({ where: { date: dateFilter } }),
        this.prisma.gscDailySite.findMany({ where: { date: prevFilter } }),
        this.prisma.siteDailyPage.groupBy({
          by: ['path'],
          where: { date: dateFilter },
          _sum: { pageviews: true, sessions: true },
          orderBy: { _sum: { pageviews: 'desc' } },
          take: 10,
        }),
        this.prisma.gscProperty.findFirst({ orderBy: { updatedAt: 'desc' } }),
      ]);

    const sumSite = (rows: typeof siteRows) =>
      rows.reduce(
        (a, r) => ({
          pageviews: a.pageviews + r.pageviews,
          sessions: a.sessions + r.sessions,
          users: a.users + r.users,
        }),
        { pageviews: 0, sessions: 0, users: 0 },
      );

    const sumGsc = (rows: typeof gscRows) => {
      const clicks = rows.reduce((a, r) => a + r.clicks, 0);
      const impressions = rows.reduce((a, r) => a + r.impressions, 0);
      const positionSum = rows.reduce((a, r) => a + r.position * r.impressions, 0);
      return {
        clicks,
        impressions,
        ctr: impressions > 0 ? clicks / impressions : 0,
        position: impressions > 0 ? positionSum / impressions : 0,
      };
    };

    const site = sumSite(siteRows);
    const sitePrev = sumSite(prevSiteRows);
    const gsc = sumGsc(gscRows);
    const gscPrev = sumGsc(prevGscRows);

    const uniquePages = await this.prisma.siteDailyPage.groupBy({
      by: ['path'],
      where: { date: dateFilter },
    });

    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      previousFrom: this.rollup.asDateOnly(prev.from),
      previousTo: this.rollup.asDateOnly(prev.to),
      site: {
        pageviews: site.pageviews,
        sessions: site.sessions,
        users: site.users,
        uniquePages: uniquePages.length,
        pagesPerSession:
          site.sessions > 0
            ? Math.round((site.pageviews / site.sessions) * 100) / 100
            : 0,
        deltas: {
          pageviews: deltaPct(site.pageviews, sitePrev.pageviews),
          sessions: deltaPct(site.sessions, sitePrev.sessions),
          users: deltaPct(site.users, sitePrev.users),
        },
      },
      gsc: {
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
        dataLagNote:
          'داده Search Console معمولاً ۲ تا ۳ روز تأخیر دارد.',
      },
      topPages: topPages.map((p) => ({
        path: p.path,
        pageviews: p._sum.pageviews ?? 0,
        sessions: p._sum.sessions ?? 0,
      })),
    };
  }

  async getSiteTimeseries(fromStr?: string, toStr?: string) {
    const { from, to } = this.resolveRange(fromStr, toStr);
    const rows = await this.prisma.siteDailySite.findMany({
      where: { date: this.rollup.dateFilter(from, to) },
      orderBy: { date: 'asc' },
    });
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      points: rows.map((r) => ({
        date: this.rollup.asDateOnly(r.date),
        pageviews: r.pageviews,
        sessions: r.sessions,
        users: r.users,
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
    const grouped = await this.prisma.siteDailyPage.groupBy({
      by: ['path'],
      where: {
        date: this.rollup.dateFilter(from, to),
        ...(opts.q
          ? { path: { contains: opts.q, mode: 'insensitive' as const } }
          : {}),
      },
      _sum: { pageviews: true, sessions: true },
    });

    const sortKey = opts.sort === 'sessions' ? 'sessions' : 'pageviews';
    const dir = opts.sortDir === 'asc' ? 1 : -1;
    const rows = grouped
      .map((g) => ({
        path: g.path,
        pageviews: g._sum.pageviews ?? 0,
        sessions: g._sum.sessions ?? 0,
      }))
      .sort((a, b) => ((a[sortKey] as number) - (b[sortKey] as number)) * dir);

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      items: rows.slice(0, limit),
      total: rows.length,
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
    const dateFilter = this.rollup.dateFilter(from, to);

    const [siteSeries, gscSeries, queries] = await Promise.all([
      this.prisma.siteDailyPage.findMany({
        where: { path, date: dateFilter },
        orderBy: { date: 'asc' },
      }),
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
