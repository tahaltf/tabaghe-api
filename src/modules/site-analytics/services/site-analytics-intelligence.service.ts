import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { SiteAnalyticsQueryService } from './site-analytics-query.service';
import { SiteAnalyticsRollupService } from './site-analytics-rollup.service';

function pathFromGscPage(page: string): string {
  try {
    if (page.startsWith('http://') || page.startsWith('https://')) {
      return new URL(page).pathname || '/';
    }
  } catch {
    /* ignore */
  }
  return page.startsWith('/') ? page : `/${page}`;
}

@Injectable()
export class SiteAnalyticsIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: SiteAnalyticsQueryService,
    private readonly rollup: SiteAnalyticsRollupService,
  ) {}

  async getOpportunities(fromStr?: string, toStr?: string) {
    const { from, to } = this.query.resolveRange(fromStr, toStr);
    const dateFilter = this.rollup.dateFilter(from, to);

    const [gscPages, gscQueries, sitePages] = await Promise.all([
      this.prisma.gscDailyPage.groupBy({
        by: ['page'],
        where: { date: dateFilter },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true },
      }),
      this.prisma.gscDailyQuery.groupBy({
        by: ['query'],
        where: { date: dateFilter },
        _sum: { clicks: true, impressions: true },
        _avg: { position: true },
      }),
      this.prisma.siteDailyPage.groupBy({
        by: ['path'],
        where: { date: dateFilter },
        _sum: { pageviews: true },
      }),
    ]);

    const siteMap = new Map(
      sitePages.map((p) => [p.path, p._sum.pageviews ?? 0]),
    );

    const lowCtrPages = gscPages
      .map((g) => {
        const clicks = g._sum.clicks ?? 0;
        const impressions = g._sum.impressions ?? 0;
        const ctr = impressions > 0 ? clicks / impressions : 0;
        const path = pathFromGscPage(g.page);
        return {
          type: 'low_ctr_page' as const,
          page: g.page,
          path,
          clicks,
          impressions,
          ctr: Math.round(ctr * 10000) / 100,
          position: Math.round((g._avg.position ?? 0) * 10) / 10,
          sitePageviews: siteMap.get(path) ?? 0,
          reason: 'ایمپرشن بالا و CTR پایین',
        };
      })
      .filter((r) => r.impressions >= 50 && r.ctr < 2)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25);

    const strikingDistance = gscQueries
      .map((g) => {
        const clicks = g._sum.clicks ?? 0;
        const impressions = g._sum.impressions ?? 0;
        const position = g._avg.position ?? 0;
        return {
          type: 'striking_distance' as const,
          query: g.query,
          clicks,
          impressions,
          ctr:
            impressions > 0
              ? Math.round((clicks / impressions) * 10000) / 100
              : 0,
          position: Math.round(position * 10) / 10,
          reason: 'رتبه ۸ تا ۲۰ — فرصت صعود به صفحه اول',
        };
      })
      .filter((r) => r.position >= 8 && r.position <= 20 && r.impressions >= 30)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 25);

    return {
      from: this.rollup.asDateOnly(from),
      to: this.rollup.asDateOnly(to),
      lowCtrPages,
      strikingDistance,
    };
  }

  async getMovers(kind: 'site' | 'gsc' = 'site') {
    const to = this.rollup.startOfUtcDay(new Date());
    const curFrom = new Date(to);
    curFrom.setUTCDate(curFrom.getUTCDate() - 6);
    const prev = this.rollup.previousRange(curFrom, to);

    if (kind === 'gsc') {
      const [cur, prevRows] = await Promise.all([
        this.prisma.gscDailyPage.groupBy({
          by: ['page'],
          where: { date: this.rollup.dateFilter(curFrom, to) },
          _sum: { clicks: true },
        }),
        this.prisma.gscDailyPage.groupBy({
          by: ['page'],
          where: { date: this.rollup.dateFilter(prev.from, prev.to) },
          _sum: { clicks: true },
        }),
      ]);
      const prevMap = new Map(
        prevRows.map((r) => [r.page, r._sum.clicks ?? 0]),
      );
      const movers = cur.map((r) => {
        const current = r._sum.clicks ?? 0;
        const previous = prevMap.get(r.page) ?? 0;
        return {
          key: r.page,
          current,
          previous,
          delta: current - previous,
          deltaPct:
            previous === 0
              ? current > 0
                ? 100
                : 0
              : Math.round(((current - previous) / previous) * 1000) / 10,
        };
      });
      const winners = [...movers].sort((a, b) => b.delta - a.delta).slice(0, 15);
      const losers = [...movers].sort((a, b) => a.delta - b.delta).slice(0, 15);
      return {
        kind,
        currentFrom: this.rollup.asDateOnly(curFrom),
        currentTo: this.rollup.asDateOnly(to),
        previousFrom: this.rollup.asDateOnly(prev.from),
        previousTo: this.rollup.asDateOnly(prev.to),
        winners,
        losers,
      };
    }

    const [cur, prevRows] = await Promise.all([
      this.prisma.siteDailyPage.groupBy({
        by: ['path'],
        where: { date: this.rollup.dateFilter(curFrom, to) },
        _sum: { pageviews: true },
      }),
      this.prisma.siteDailyPage.groupBy({
        by: ['path'],
        where: { date: this.rollup.dateFilter(prev.from, prev.to) },
        _sum: { pageviews: true },
      }),
    ]);
    const prevMap = new Map(
      prevRows.map((r) => [r.path, r._sum.pageviews ?? 0]),
    );
    const movers = cur.map((r) => {
      const current = r._sum.pageviews ?? 0;
      const previous = prevMap.get(r.path) ?? 0;
      return {
        key: r.path,
        current,
        previous,
        delta: current - previous,
        deltaPct:
          previous === 0
            ? current > 0
              ? 100
              : 0
            : Math.round(((current - previous) / previous) * 1000) / 10,
      };
    });
    const winners = [...movers].sort((a, b) => b.delta - a.delta).slice(0, 15);
    const losers = [...movers].sort((a, b) => a.delta - b.delta).slice(0, 15);
    return {
      kind,
      currentFrom: this.rollup.asDateOnly(curFrom),
      currentTo: this.rollup.asDateOnly(to),
      previousFrom: this.rollup.asDateOnly(prev.from),
      previousTo: this.rollup.asDateOnly(prev.to),
      winners,
      losers,
    };
  }

  async getDecay() {
    const to = this.rollup.startOfUtcDay(new Date());
    const recentFrom = new Date(to);
    recentFrom.setUTCDate(recentFrom.getUTCDate() - 13);
    const olderTo = new Date(recentFrom);
    olderTo.setUTCDate(olderTo.getUTCDate() - 1);
    const olderFrom = new Date(olderTo);
    olderFrom.setUTCDate(olderFrom.getUTCDate() - 13);

    const [recent, older] = await Promise.all([
      this.prisma.siteDailyPage.groupBy({
        by: ['path'],
        where: { date: this.rollup.dateFilter(recentFrom, to) },
        _sum: { pageviews: true },
      }),
      this.prisma.siteDailyPage.groupBy({
        by: ['path'],
        where: { date: this.rollup.dateFilter(olderFrom, olderTo) },
        _sum: { pageviews: true },
      }),
    ]);

    const recentMap = new Map(
      recent.map((r) => [r.path, r._sum.pageviews ?? 0]),
    );
    const items = older
      .map((o) => {
        const previous = o._sum.pageviews ?? 0;
        const current = recentMap.get(o.path) ?? 0;
        if (previous < 20) return null;
        const dropPct = ((previous - current) / previous) * 100;
        if (dropPct < 30) return null;
        return {
          path: o.path,
          previous,
          current,
          dropPct: Math.round(dropPct * 10) / 10,
          reason: 'افت پایدار بازدید نسبت به دو هفتهٔ قبل',
        };
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.dropPct - a.dropPct)
      .slice(0, 30);

    return {
      recentFrom: this.rollup.asDateOnly(recentFrom),
      recentTo: this.rollup.asDateOnly(to),
      olderFrom: this.rollup.asDateOnly(olderFrom),
      olderTo: this.rollup.asDateOnly(olderTo),
      items,
    };
  }

  async getIssues(thresholdPct = 25) {
    const [overview, gsc] = await Promise.all([
      this.query.getOverview(),
      this.query.getGscOverview(),
    ]);
    const issues: Array<{
      severity: 'warning' | 'critical';
      code: string;
      message: string;
    }> = [];

    const visitorsDelta = overview.site.deltas.visitors;
    if (visitorsDelta !== null && visitorsDelta <= -thresholdPct) {
      issues.push({
        severity: visitorsDelta <= -50 ? 'critical' : 'warning',
        code: 'site_visitors_drop',
        message: `بازدیدکننده یکتای سایت نسبت به دوره قبل ${Math.abs(visitorsDelta)}٪ افت کرده است.`,
      });
    }

    const pvDelta = overview.site.deltas.pageviews;
    if (pvDelta !== null && pvDelta <= -thresholdPct) {
      issues.push({
        severity: pvDelta <= -50 ? 'critical' : 'warning',
        code: 'site_pageviews_drop',
        message: `بازدید صفحه نسبت به دوره قبل ${Math.abs(pvDelta)}٪ افت کرده است.`,
      });
    }

    const clickDelta = gsc.deltas.clicks;
    if (clickDelta !== null && clickDelta <= -thresholdPct) {
      issues.push({
        severity: clickDelta <= -50 ? 'critical' : 'warning',
        code: 'gsc_clicks_drop',
        message: `کلیک گوگل نسبت به دوره قبل ${Math.abs(clickDelta)}٪ افت کرده است.`,
      });
    }

    if (gsc.property?.status === 'ERROR') {
      issues.push({
        severity: 'critical',
        code: 'gsc_connection_error',
        message: gsc.property.lastError || 'خطا در اتصال Search Console',
      });
    }

    const decay = await this.getDecay();
    if (decay.items.length >= 5) {
      issues.push({
        severity: 'warning',
        code: 'content_decay',
        message: `${decay.items.length} صفحه دچار افت پایدار بازدید هستند.`,
      });
    }

    return {
      thresholdPct,
      issues,
      overviewRange: { from: overview.from, to: overview.to },
    };
  }
}
