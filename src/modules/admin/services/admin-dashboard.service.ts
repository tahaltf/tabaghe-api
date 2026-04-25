import { Injectable } from '@nestjs/common';
import {
  ListingType,
  ListingStatus,
  OrderStatus,
  RepairRequestStatus,
  TicketStatus,
  UserStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type ProfitRange = 'today' | '7d' | '30d' | '90d' | '365d' | 'all';

export interface ProfitSummary {
  range: ProfitRange;
  totalProfit: number;
  totalSales: number;
  totalOrders: number;
  today: number;
  last7: number;
  last30: number;
  last90: number;
  allTime: number;
  series: Array<{ date: string; profit: number; sales: number; orders: number }>;
}

/**
 * Orders whose platformFee is considered realized (booked as platform income).
 * We include COMPLETED and DELIVERED – at that point escrow has been released
 * and the commission is effectively earned by the platform.
 */
const REALIZED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.DELIVERED,
];

export interface AdminDashboardStats {
  users: {
    total: number;
    approved: number;
    pendingKyc: number;
    incomplete: number;
    rejected: number;
    newLast7Days: number;
  };
  listings: {
    total: number;
    active: number;
    pending: number;
    rejected: number;
    sold: number;
    direct: number;
    auction: number;
    exchange: number;
  };
  orders: {
    total: number;
    pending: number;
    inHub: number;
    completed: number;
    disputed: number;
    verificationFlow: {
      awaitingShipmentToHub: number;
      shippedToHub: number;
      receivedAtHub: number;
      checkingAtHub: number;
      verifiedAtHub: number;
      shippedToBuyer: number;
    };
  };
  revenue: {
    totalCommission: number;
    totalSales: number;
    walletBalanceAvailable: number;
    walletBalanceBlocked: number;
  };
  repair: {
    pending: number;
    active: number;
  };
  tickets: {
    open: number;
    answered: number;
  };
  recentActivity: Array<{
    id: string;
    kind: 'user' | 'listing' | 'order';
    title: string;
    subtitle: string;
    createdAt: Date;
  }>;
}

export type DashboardWindow = 'day' | 'week' | 'year';

const HUB_ACTIVE: OrderStatus[] = [
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.SHIPPED_TO_HUB,
  OrderStatus.RECEIVED_AT_HUB,
  OrderStatus.CHECKING_AT_HUB,
  OrderStatus.VERIFIED_AT_HUB,
  OrderStatus.SHIPPED_TO_BUYER,
];

@Injectable()
export class AdminDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats(): Promise<AdminDashboardStats> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      usersTotal,
      usersApproved,
      usersPendingKyc,
      usersIncomplete,
      usersRejected,
      usersNew7,
      listingsTotal,
      listingsApproved,
      listingsPending,
      listingsRejected,
      listingsSold,
      listingsDirect,
      listingsAuction,
      listingsExchange,
      ordersTotal,
      ordersPending,
      ordersHub,
      ordersCompleted,
      ordersDisputed,
      ordersAwaitingShipmentToHub,
      ordersShippedToHub,
      ordersReceivedAtHub,
      ordersCheckingAtHub,
      ordersVerifiedAtHub,
      ordersShippedToBuyer,
      commissionAgg,
      salesAgg,
      walletAgg,
      repairPending,
      repairActive,
      ticketsOpen,
      ticketsAnswered,
      recentUsers,
      recentListings,
      recentOrders,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { status: UserStatus.APPROVED } }),
      this.prisma.user.count({ where: { status: UserStatus.PENDING } }),
      this.prisma.user.count({ where: { status: UserStatus.INCOMPLETE } }),
      this.prisma.user.count({ where: { status: UserStatus.REJECTED } }),
      this.prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),

      this.prisma.listing.count(),
      this.prisma.listing.count({ where: { status: ListingStatus.APPROVED } }),
      this.prisma.listing.count({ where: { status: ListingStatus.PENDING } }),
      this.prisma.listing.count({ where: { status: ListingStatus.REJECTED } }),
      this.prisma.listing.count({ where: { status: ListingStatus.SOLD } }),
      this.prisma.listing.count({ where: { type: ListingType.DIRECT } }),
      this.prisma.listing.count({ where: { type: ListingType.AUCTION } }),
      this.prisma.listing.count({ where: { type: ListingType.EXCHANGE } }),

      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: OrderStatus.PENDING } }),
      this.prisma.order.count({ where: { status: { in: HUB_ACTIVE } } }),
      this.prisma.order.count({ where: { status: OrderStatus.COMPLETED } }),
      this.prisma.order.count({ where: { status: OrderStatus.DISPUTED } }),
      this.prisma.order.count({ where: { status: OrderStatus.AWAITING_SHIPMENT_TO_HUB } }),
      this.prisma.order.count({ where: { status: OrderStatus.SHIPPED_TO_HUB } }),
      this.prisma.order.count({ where: { status: OrderStatus.RECEIVED_AT_HUB } }),
      this.prisma.order.count({ where: { status: OrderStatus.CHECKING_AT_HUB } }),
      this.prisma.order.count({ where: { status: OrderStatus.VERIFIED_AT_HUB } }),
      this.prisma.order.count({ where: { status: OrderStatus.SHIPPED_TO_BUYER } }),

      this.prisma.order.aggregate({
        where: { status: { in: REALIZED_ORDER_STATUSES } },
        _sum: { platformFee: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: REALIZED_ORDER_STATUSES } },
        _sum: { totalAmount: true },
      }),
      this.prisma.wallet.aggregate({
        _sum: { balanceAvailable: true, balanceBlocked: true },
      }),

      this.prisma.repairRequest.count({
        where: { status: RepairRequestStatus.PENDING_REVIEW },
      }),
      this.prisma.repairRequest.count({
        where: {
          status: {
            in: [
              RepairRequestStatus.APPROVED,
              RepairRequestStatus.DELIVERY_TIME_SELECTED,
              RepairRequestStatus.IN_PROGRESS,
            ],
          },
        },
      }),

      this.prisma.ticket.count({ where: { status: TicketStatus.OPEN } }),
      this.prisma.ticket.count({ where: { status: TicketStatus.ANSWERED } }),

      this.prisma.user.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          phone: true,
          firstName: true,
          lastName: true,
          createdAt: true,
        },
      }),
      this.prisma.listing.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
      this.prisma.order.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          listing: { select: { title: true } },
        },
      }),
    ]);

    const commission = new Decimal(commissionAgg._sum.platformFee ?? 0);
    const sales = new Decimal(salesAgg._sum.totalAmount ?? 0);
    const walletAvail = new Decimal(walletAgg._sum.balanceAvailable ?? 0);
    const walletBlocked = new Decimal(walletAgg._sum.balanceBlocked ?? 0);

    const recentActivity = [
      ...recentUsers.map((u) => ({
        id: u.id,
        kind: 'user' as const,
        title: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.phone,
        subtitle: u.phone,
        createdAt: u.createdAt,
      })),
      ...recentListings.map((l) => ({
        id: l.id,
        kind: 'listing' as const,
        title: l.title,
        subtitle: `وضعیت: ${l.status}`,
        createdAt: l.createdAt,
      })),
      ...recentOrders.map((o) => ({
        id: o.id,
        kind: 'order' as const,
        title: o.listing.title,
        subtitle: `${o.status} • ${o.totalAmount.toString()}`,
        createdAt: o.createdAt,
      })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);

    return {
      users: {
        total: usersTotal,
        approved: usersApproved,
        pendingKyc: usersPendingKyc,
        incomplete: usersIncomplete,
        rejected: usersRejected,
        newLast7Days: usersNew7,
      },
      listings: {
        total: listingsTotal,
        active: listingsApproved,
        pending: listingsPending,
        rejected: listingsRejected,
        sold: listingsSold,
        direct: listingsDirect,
        auction: listingsAuction,
        exchange: listingsExchange,
      },
      orders: {
        total: ordersTotal,
        pending: ordersPending,
        inHub: ordersHub,
        completed: ordersCompleted,
        disputed: ordersDisputed,
        verificationFlow: {
          awaitingShipmentToHub: ordersAwaitingShipmentToHub,
          shippedToHub: ordersShippedToHub,
          receivedAtHub: ordersReceivedAtHub,
          checkingAtHub: ordersCheckingAtHub,
          verifiedAtHub: ordersVerifiedAtHub,
          shippedToBuyer: ordersShippedToBuyer,
        },
      },
      revenue: {
        totalCommission: commission.toNumber(),
        totalSales: sales.toNumber(),
        walletBalanceAvailable: walletAvail.toNumber(),
        walletBalanceBlocked: walletBlocked.toNumber(),
      },
      repair: { pending: repairPending, active: repairActive },
      tickets: { open: ticketsOpen, answered: ticketsAnswered },
      recentActivity,
    };
  }

  async getKpisByWindow(window: DashboardWindow = 'week') {
    const since =
      window === 'day'
        ? sinceDaysAgo(1, new Date())
        : window === 'year'
          ? sinceDaysAgo(365, new Date())
          : sinceDaysAgo(7, new Date());

    const [
      ordersCount,
      usersActiveCount,
      repairsCount,
      walletAgg,
      profitAgg,
      verificationAgg,
      penaltiesAgg,
    ] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { lastLoginAt: { gte: since } } }),
      this.prisma.repairRequest.count({ where: { createdAt: { gte: since } } }),
      this.prisma.wallet.aggregate({ _sum: { balanceAvailable: true, balanceBlocked: true } }),
      this.prisma.order.aggregate({
        where: { status: { in: REALIZED_ORDER_STATUSES }, createdAt: { gte: since } },
        _sum: { platformFee: true },
      }),
      this.prisma.order.aggregate({
        where: { requiresVerification: true, status: { in: REALIZED_ORDER_STATUSES }, createdAt: { gte: since } },
        _sum: { verificationFee: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { type: WalletTransactionType.PENALTY, status: WalletTransactionStatus.SUCCESS, createdAt: { gte: since } },
        _sum: { amount: true },
      }),
    ]);

    const platformBalance = new Decimal(walletAgg._sum.balanceAvailable ?? 0).plus(walletAgg._sum.balanceBlocked ?? 0);
    const blocked = new Decimal(walletAgg._sum.balanceBlocked ?? 0);
    const profit = new Decimal(profitAgg._sum.platformFee ?? 0)
      .plus(verificationAgg._sum.verificationFee ?? 0)
      .plus(penaltiesAgg._sum.amount ?? 0);

    return {
      window,
      since,
      ordersCount,
      platformBalance: platformBalance.toNumber(),
      platformProfit: profit.toNumber(),
      blockedBalance: blocked.toNumber(),
      activeUsers: usersActiveCount,
      repairRequests: repairsCount,
    };
  }

  async getRevenueTimeseries(days = 30): Promise<
    Array<{ date: string; sales: number; commission: number; orders: number }>
  > {
    const safeDays = Math.max(1, Math.min(365, days));
    const since = startOfDay(new Date(Date.now() - (safeDays - 1) * DAY_MS));

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: since },
        status: { in: REALIZED_ORDER_STATUSES },
      },
      select: { totalAmount: true, platformFee: true, createdAt: true },
    });

    const buckets = initDayBuckets(since, safeDays);

    for (const o of orders) {
      const key = toDayKey(o.createdAt);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.sales = bucket.sales.plus(o.totalAmount);
        bucket.commission = bucket.commission.plus(o.platformFee);
        bucket.orders += 1;
      }
    }

    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      sales: v.sales.toNumber(),
      commission: v.commission.toNumber(),
      orders: v.orders,
    }));
  }

  /**
   * Aggregated profit report for the admin dashboard.
   * Supports several presets and always returns quick-reference values
   * (today / 7d / 30d / 90d / all-time) regardless of the chosen range.
   */
  async getProfit(range: ProfitRange = '30d'): Promise<ProfitSummary> {
    const now = new Date();
    const windowDays = rangeDays(range);

    const [all, last90Agg, last30Agg, last7Agg, todayAgg] = await Promise.all([
      this.prisma.order.aggregate({
        where: { status: { in: REALIZED_ORDER_STATUSES } },
        _sum: { platformFee: true, totalAmount: true },
        _count: true,
      }),
      this.sumProfit(sinceDaysAgo(90, now)),
      this.sumProfit(sinceDaysAgo(30, now)),
      this.sumProfit(sinceDaysAgo(7, now)),
      this.sumProfit(startOfDay(now)),
    ]);

    const allTime = new Decimal(all._sum.platformFee ?? 0).toNumber();

    // For the requested range, aggregate with the appropriate window (or all-time)
    let windowSales = new Decimal(0);
    let windowProfit = new Decimal(0);
    let windowCount = 0;
    let series: ProfitSummary['series'] = [];

    if (windowDays === null) {
      windowSales = new Decimal(all._sum.totalAmount ?? 0);
      windowProfit = new Decimal(all._sum.platformFee ?? 0);
      windowCount = all._count;
      series = await this.monthlySeriesAllTime();
    } else {
      const since = startOfDay(new Date(now.getTime() - (windowDays - 1) * DAY_MS));
      const orders = await this.prisma.order.findMany({
        where: { createdAt: { gte: since }, status: { in: REALIZED_ORDER_STATUSES } },
        select: { totalAmount: true, platformFee: true, createdAt: true },
      });
      const buckets = initDayBuckets(since, windowDays);
      for (const o of orders) {
        const key = toDayKey(o.createdAt);
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.sales = bucket.sales.plus(o.totalAmount);
          bucket.commission = bucket.commission.plus(o.platformFee);
          bucket.orders += 1;
        }
        windowSales = windowSales.plus(o.totalAmount);
        windowProfit = windowProfit.plus(o.platformFee);
        windowCount += 1;
      }
      series = Array.from(buckets.entries()).map(([date, v]) => ({
        date,
        profit: v.commission.toNumber(),
        sales: v.sales.toNumber(),
        orders: v.orders,
      }));
    }

    return {
      range,
      totalProfit: windowProfit.toNumber(),
      totalSales: windowSales.toNumber(),
      totalOrders: windowCount,
      today: todayAgg,
      last7: last7Agg,
      last30: last30Agg,
      last90: last90Agg,
      allTime,
      series,
    };
  }

  private async sumProfit(since: Date): Promise<number> {
    const agg = await this.prisma.order.aggregate({
      where: { createdAt: { gte: since }, status: { in: REALIZED_ORDER_STATUSES } },
      _sum: { platformFee: true },
    });
    return new Decimal(agg._sum.platformFee ?? 0).toNumber();
  }

  private async monthlySeriesAllTime(): Promise<ProfitSummary['series']> {
    const orders = await this.prisma.order.findMany({
      where: { status: { in: REALIZED_ORDER_STATUSES } },
      select: { totalAmount: true, platformFee: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    if (orders.length === 0) return [];

    const buckets = new Map<string, { profit: Decimal; sales: Decimal; orders: number }>();
    for (const o of orders) {
      const key = o.createdAt.toISOString().slice(0, 7); // YYYY-MM
      const b = buckets.get(key) ?? { profit: new Decimal(0), sales: new Decimal(0), orders: 0 };
      b.profit = b.profit.plus(o.platformFee);
      b.sales = b.sales.plus(o.totalAmount);
      b.orders += 1;
      buckets.set(key, b);
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      profit: v.profit.toNumber(),
      sales: v.sales.toNumber(),
      orders: v.orders,
    }));
  }
}

// ----------- helpers -----------

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function sinceDaysAgo(days: number, now: Date): Date {
  return startOfDay(new Date(now.getTime() - (days - 1) * DAY_MS));
}

function toDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function initDayBuckets(since: Date, days: number) {
  const map = new Map<string, { sales: Decimal; commission: Decimal; orders: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * DAY_MS);
    map.set(toDayKey(d), { sales: new Decimal(0), commission: new Decimal(0), orders: 0 });
  }
  return map;
}

function rangeDays(range: ProfitRange): number | null {
  switch (range) {
    case 'today': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case '90d': return 90;
    case '365d': return 365;
    case 'all': return null;
  }
}
