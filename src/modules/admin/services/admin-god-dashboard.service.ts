import { Injectable } from '@nestjs/common';
import { ListingStatus, OrderStatus, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type GodRange = '24h' | '7d' | '30d' | '90d';
export const GOD_RANGES: GodRange[] = ['24h', '7d', '30d', '90d'];

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
/** Iran has used a fixed UTC+03:30 offset since DST was abolished in 2022. */
const TEHRAN_OFFSET_MS = 210 * 60 * 1000;
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const TOP_LIMIT = 8;

const REALIZED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.DELIVERED,
];

export interface TrafficTotals {
  pageviews: number;
  sessions: number;
  visitors: number;
}

export interface GodOverview {
  range: GodRange;
  bucket: 'hour' | 'day';
  from: string;
  to: string;
  generatedAt: string;
  online: number;
  traffic: {
    today: TrafficTotals;
    yesterday: TrafficTotals;
    last7: TrafficTotals;
    current: TrafficTotals;
    previous: TrafficTotals;
  };
  commerce: {
    current: CommerceTotals;
    previous: CommerceTotals;
  };
  series: Array<{
    key: string;
    pageviews: number;
    sessions: number;
    gmv: number;
    orders: number;
  }>;
  topPages: Array<{ path: string; title: string | null; pageviews: number; visitors: number }>;
  topListings: Array<{
    id: string;
    title: string;
    thumbnail: string | null;
    status: ListingStatus;
    pageviews: number;
    visitors: number;
  }>;
}

interface CommerceTotals {
  gmv: number;
  commission: number;
  realizedOrders: number;
  placedOrders: number;
  newUsers: number;
  newListings: number;
}

@Injectable()
export class AdminGodDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(range: GodRange): Promise<GodOverview> {
    const now = new Date();
    const bucket: 'hour' | 'day' = range === '24h' ? 'hour' : 'day';
    const { from, slots } = this.window(range, now);
    const prevFrom = new Date(from.getTime() - (now.getTime() - from.getTime()));

    const todayStart = tehranDayStart(now);
    const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
    const last7Start = new Date(todayStart.getTime() - 6 * DAY_MS);

    const [
      online,
      today,
      yesterday,
      last7,
      current,
      previous,
      commerceCurrent,
      commercePrevious,
      trafficSeries,
      orders,
      topPages,
      topListings,
    ] = await Promise.all([
      this.onlineSessions(now),
      this.traffic(todayStart, now),
      this.traffic(yesterdayStart, todayStart),
      this.traffic(last7Start, now),
      this.traffic(from, now),
      this.traffic(prevFrom, from),
      this.commerce(from, now),
      this.commerce(prevFrom, from),
      this.trafficSeries(from, bucket),
      this.prisma.order.findMany({
        where: { createdAt: { gte: from }, status: { in: REALIZED_ORDER_STATUSES } },
        select: { totalAmount: true, createdAt: true },
      }),
      this.topPages(from),
      this.topListings(from),
    ]);

    const buckets = new Map<string, GodOverview['series'][number]>();
    for (let i = 0; i < slots; i++) {
      const t = new Date(from.getTime() + i * (bucket === 'hour' ? HOUR_MS : DAY_MS));
      const key = bucketKey(t, bucket);
      buckets.set(key, { key, pageviews: 0, sessions: 0, gmv: 0, orders: 0 });
    }
    for (const row of trafficSeries) {
      const b = buckets.get(row.key);
      if (b) {
        b.pageviews = row.pageviews;
        b.sessions = row.sessions;
      }
    }
    for (const o of orders) {
      const b = buckets.get(bucketKey(o.createdAt, bucket));
      if (b) {
        b.gmv += new Decimal(o.totalAmount).toNumber();
        b.orders += 1;
      }
    }

    return {
      range,
      bucket,
      from: from.toISOString(),
      to: now.toISOString(),
      generatedAt: now.toISOString(),
      online,
      traffic: { today, yesterday, last7, current, previous },
      commerce: { current: commerceCurrent, previous: commercePrevious },
      series: Array.from(buckets.values()),
      topPages,
      topListings,
    };
  }

  private window(range: GodRange, now: Date): { from: Date; slots: number } {
    if (range === '24h') {
      const hourStart = new Date(Math.floor(now.getTime() / HOUR_MS) * HOUR_MS);
      return { from: new Date(hourStart.getTime() - 23 * HOUR_MS), slots: 24 };
    }
    const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
    return {
      from: new Date(tehranDayStart(now).getTime() - (days - 1) * DAY_MS),
      slots: days,
    };
  }

  private async onlineSessions(now: Date): Promise<number> {
    const since = new Date(now.getTime() - ONLINE_WINDOW_MS);
    const rows = await this.prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(DISTINCT "sessionId")::bigint AS n
      FROM "SitePageView"
      WHERE "viewedAt" >= ${since}
    `;
    return Number(rows[0]?.n ?? 0);
  }

  private async traffic(from: Date, to: Date): Promise<TrafficTotals> {
    const rows = await this.prisma.$queryRaw<
      Array<{ pv: bigint; s: bigint; v: bigint }>
    >`
      SELECT
        COUNT(*)::bigint AS pv,
        COUNT(DISTINCT "sessionId")::bigint AS s,
        COUNT(DISTINCT COALESCE("userId", 's:' || "sessionId"))::bigint AS v
      FROM "SitePageView"
      WHERE "viewedAt" >= ${from} AND "viewedAt" < ${to}
    `;
    const r = rows[0];
    return {
      pageviews: Number(r?.pv ?? 0),
      sessions: Number(r?.s ?? 0),
      visitors: Number(r?.v ?? 0),
    };
  }

  private async trafficSeries(
    from: Date,
    bucket: 'hour' | 'day',
  ): Promise<Array<{ key: string; pageviews: number; sessions: number }>> {
    const unit = Prisma.raw(bucket === 'hour' ? `'hour'` : `'day'`);
    const rows = await this.prisma.$queryRaw<
      Array<{ b: Date; pv: bigint; s: bigint }>
    >`
      SELECT
        date_trunc(${unit}, "viewedAt" + interval '210 minutes') AS b,
        COUNT(*)::bigint AS pv,
        COUNT(DISTINCT "sessionId")::bigint AS s
      FROM "SitePageView"
      WHERE "viewedAt" >= ${from}
      GROUP BY 1
    `;
    return rows.map((r) => ({
      key: shiftedKey(r.b, bucket),
      pageviews: Number(r.pv),
      sessions: Number(r.s),
    }));
  }

  private async commerce(from: Date, to: Date): Promise<CommerceTotals> {
    const created = { gte: from, lt: to };
    const [realized, placedOrders, newUsers, newListings] = await Promise.all([
      this.prisma.order.aggregate({
        where: { createdAt: created, status: { in: REALIZED_ORDER_STATUSES } },
        _sum: { totalAmount: true, platformFee: true },
        _count: true,
      }),
      this.prisma.order.count({ where: { createdAt: created } }),
      this.prisma.user.count({ where: { createdAt: created } }),
      this.prisma.listing.count({ where: { createdAt: created } }),
    ]);
    return {
      gmv: new Decimal(realized._sum.totalAmount ?? 0).toNumber(),
      commission: new Decimal(realized._sum.platformFee ?? 0).toNumber(),
      realizedOrders: realized._count,
      placedOrders,
      newUsers,
      newListings,
    };
  }

  /** Same semantics as site-analytics: visitor = distinct userId, or distinct session for guests. */
  private async topPages(from: Date): Promise<GodOverview['topPages']> {
    const rows = await this.prisma.$queryRaw<
      Array<{ path: string; title: string | null; pv: bigint; v: bigint }>
    >`
      SELECT
        "path",
        MAX("title") AS title,
        COUNT(*)::bigint AS pv,
        COUNT(DISTINCT COALESCE("userId", 's:' || "sessionId"))::bigint AS v
      FROM "SitePageView"
      WHERE "viewedAt" >= ${from}
      GROUP BY "path"
      ORDER BY pv DESC
      LIMIT ${TOP_LIMIT}
    `;
    return rows.map((r) => ({
      path: r.path,
      title: r.title,
      pageviews: Number(r.pv),
      visitors: Number(r.v),
    }));
  }

  /** Ranked from `/listing/:id` pageviews so numbers match the site-analytics page. */
  private async topListings(from: Date): Promise<GodOverview['topListings']> {
    const grouped = await this.prisma.$queryRaw<
      Array<{ id: string; pv: bigint; v: bigint }>
    >`
      SELECT
        substring("path" from '^/listing/([^/?#]+)') AS id,
        COUNT(*)::bigint AS pv,
        COUNT(DISTINCT COALESCE("userId", 's:' || "sessionId"))::bigint AS v
      FROM "SitePageView"
      WHERE "viewedAt" >= ${from} AND "path" ~ '^/listing/[^/?#]+'
      GROUP BY 1
      ORDER BY pv DESC
      LIMIT ${TOP_LIMIT * 2}
    `;
    if (!grouped.length) return [];

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: grouped.map((g) => g.id) } },
      select: { id: true, title: true, thumbnail: true, status: true },
    });
    const byId = new Map(listings.map((l) => [l.id, l]));

    return grouped
      .flatMap((g) => {
        const l = byId.get(g.id);
        return l ? [{ ...l, pageviews: Number(g.pv), visitors: Number(g.v) }] : [];
      })
      .slice(0, TOP_LIMIT);
  }
}

function tehranDayStart(now: Date): Date {
  const local = now.getTime() + TEHRAN_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - TEHRAN_OFFSET_MS);
}

/** Key in Tehran local time, matching the SQL `date_trunc(... + 210 minutes)` buckets. */
function bucketKey(d: Date, bucket: 'hour' | 'day'): string {
  return shiftedKey(new Date(d.getTime() + TEHRAN_OFFSET_MS), bucket);
}

function shiftedKey(shifted: Date, bucket: 'hour' | 'day'): string {
  const iso = shifted.toISOString();
  return bucket === 'hour' ? iso.slice(0, 13) : iso.slice(0, 10);
}
