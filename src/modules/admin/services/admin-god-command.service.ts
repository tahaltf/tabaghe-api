import { Injectable } from '@nestjs/common';
import {
  ListingMergeRequestStatus,
  ListingStatus,
  OrderStatus,
  ProductRequestStatus,
  PurchaseOfferStatus,
  RepairRequestStatus,
  SellerLeadStage,
  TicketStatus,
  UserStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  AdminGodDashboardService,
  GOD_RANGES,
  GodRange,
} from './admin-god-dashboard.service';
import { AdminPlatformWalletService } from './admin-platform-wallet.service';
import { AdminServerMonitorService } from './admin-server-monitor.service';
import type {
  GodCommand,
  GodFunnelStage,
  GodInboxItem,
  GodInboxSeverity,
} from './admin-god-command.types';

const MANUAL_DEPOSIT_KIND = 'manual-deposit';
const DAY_MS = 24 * 60 * 60 * 1000;
const TEHRAN_OFFSET_MS = 210 * 60 * 1000;

const REALIZED: OrderStatus[] = [OrderStatus.COMPLETED, OrderStatus.DELIVERED];

const HUB_ACTIVE: OrderStatus[] = [
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.SHIPPED_TO_HUB,
  OrderStatus.RECEIVED_AT_HUB,
  OrderStatus.CHECKING_AT_HUB,
  OrderStatus.VERIFIED_AT_HUB,
  OrderStatus.SHIPPED_TO_BUYER,
];

const OPEN_ORDER: OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  ...HUB_ACTIVE,
  OrderStatus.REJECTED_AT_HUB,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.RETURN_REQUESTED,
  OrderStatus.RETURN_SHIPPED,
  OrderStatus.DISPUTED,
];

const CRM_OPEN: SellerLeadStage[] = [
  SellerLeadStage.NEW,
  SellerLeadStage.CONTACTED,
  SellerLeadStage.INTERESTED,
  SellerLeadStage.ONBOARDING,
];

const SEVERITY_RANK: Record<GodInboxSeverity, number> = {
  critical: 5,
  financial: 4,
  overdue: 3,
  listings: 2,
  routine: 1,
};

@Injectable()
export class AdminGodCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly overview: AdminGodDashboardService,
    private readonly monitor: AdminServerMonitorService,
    private readonly platformWallet: AdminPlatformWalletService,
  ) {}

  async getCommand(range: GodRange): Promise<GodCommand> {
    if (!GOD_RANGES.includes(range)) {
      throw new Error('invalid range');
    }

    const now = new Date();
    const todayStart = tehranDayStart(now);
    const rangeFrom = rangeWindowStart(range, now);

    const [
      overview,
      monitor,
      wallet,
      listingCounts,
      listingExtras,
      orderStatusGroups,
      stageWaits,
      overdueTotal,
      walletQueues,
      contact,
      kyc,
      tickets,
      repairs,
      merges,
      productRequests,
      purchaseOffers,
      crmDue,
      crmOverdue,
      listingPageviews,
    ] = await Promise.all([
      this.overview.getOverview(range),
      this.monitor.getOverview(),
      this.platformWallet.getSummary(),
      this.listingStatusCounts(),
      this.listingExtraCounts(todayStart),
      this.orderStatusCounts(),
      this.funnelWaitStats(now),
      this.countOverdueOrders(now),
      this.walletQueueStats(),
      this.contactUnreadStats(),
      this.oldestAndCount(
        this.prisma.user,
        { status: UserStatus.PENDING },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.ticket,
        { status: TicketStatus.OPEN },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.repairRequest,
        { status: RepairRequestStatus.PENDING_REVIEW },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.listingMergeRequest,
        { status: ListingMergeRequestStatus.PENDING },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.productRequest,
        { status: ProductRequestStatus.PENDING },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.purchaseOffer,
        { status: PurchaseOfferStatus.PENDING },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.sellerLead,
        {
          stage: { in: CRM_OPEN },
          nextFollowUpAt: {
            gte: startOfLocalDay(now),
            lte: endOfLocalDay(now),
          },
        },
        'nextFollowUpAt',
      ),
      this.oldestAndCount(
        this.prisma.sellerLead,
        {
          stage: { in: CRM_OPEN },
          nextFollowUpAt: { lt: startOfLocalDay(now) },
        },
        'nextFollowUpAt',
      ),
      this.countListingPageviews(rangeFrom),
    ]);

    const listingsPending = await this.oldestAndCount(
      this.prisma.listing,
      { status: ListingStatus.PENDING },
      'createdAt',
    );
    const disputes = await this.oldestAndCount(
      this.prisma.order,
      { status: OrderStatus.DISPUTED, disputeResolvedAt: null },
      'disputedAt',
    );
    const hubActionable = await this.oldestAndCount(
      this.prisma.order,
      {
        status: {
          in: [OrderStatus.RECEIVED_AT_HUB, OrderStatus.CHECKING_AT_HUB],
        },
      },
      'updatedAt',
    );
    const awaitingPayment = await this.oldestAndCount(
      this.prisma.order,
      { status: OrderStatus.AWAITING_PAYMENT },
      'createdAt',
    );
    const paymentOverdue = await this.countPaymentOverdue(now);

    const inbox = this.buildInbox({
      disputes,
      awaitingPayment: {
        count: awaitingPayment.count,
        oldestAgeSec: awaitingPayment.oldestAgeSec,
      },
      paymentOverdue,
      hubActionable,
      withdraws: walletQueues.withdraws,
      deposits: walletQueues.deposits,
      tickets,
      contact,
      crmOverdue,
      listingsPending,
      productRequests,
      purchaseOffers,
      repairs,
      merges,
      kyc,
      crmDue,
      overdueTotal,
    });

    const hubCounts = {
      awaitingShipmentToHub: orderStatusGroups.get(OrderStatus.AWAITING_SHIPMENT_TO_HUB) ?? 0,
      shippedToHub: orderStatusGroups.get(OrderStatus.SHIPPED_TO_HUB) ?? 0,
      receivedAtHub: orderStatusGroups.get(OrderStatus.RECEIVED_AT_HUB) ?? 0,
      checkingAtHub: orderStatusGroups.get(OrderStatus.CHECKING_AT_HUB) ?? 0,
      verifiedAtHub: orderStatusGroups.get(OrderStatus.VERIFIED_AT_HUB) ?? 0,
      shippedToBuyer: orderStatusGroups.get(OrderStatus.SHIPPED_TO_BUYER) ?? 0,
    };

    const activeTransactions = OPEN_ORDER.reduce(
      (n, s) => n + (orderStatusGroups.get(s) ?? 0),
      0,
    );

    const funnel = this.buildFunnel(orderStatusGroups, hubCounts, stageWaits);

    const realizationRate =
      overview.commerce.current.placedOrders > 0
        ? Math.round(
            (overview.commerce.current.realizedOrders /
              overview.commerce.current.placedOrders) *
              1000,
          ) / 1000
        : null;

    const dbCheck = monitor.healthChecks.find((h) => h.id === 'database');
    const dbLatencyMs = parseLatencyMs(dbCheck?.detail);

    return {
      header: {
        generatedAt: now.toISOString(),
        range,
        from: overview.from,
        to: overview.to,
        online: overview.online,
        systemOverallStatus: monitor.overallStatus,
      },
      kpis: {
        activeListings: listingCounts.active,
        newListingsInRange: overview.commerce.current.newListings,
        activeTransactions,
        successfulInRange: overview.commerce.current.realizedOrders,
        collectedCommissionInRange: overview.commerce.current.commission,
        pendingActionsTotal: inbox.reduce((n, i) => n + i.count, 0),
      },
      inbox,
      listings: {
        total: listingCounts.total,
        active: listingCounts.active,
        pending: listingCounts.pending,
        rejected: listingCounts.rejected,
        sold: listingCounts.sold,
        draft: listingCounts.draft,
        archived: listingCounts.archived,
        newToday: listingExtras.newToday,
        noImages: listingExtras.noImages,
        noViews: listingExtras.noViews,
        withPendingPurchaseOffers: listingExtras.withPendingPurchaseOffers,
      },
      transactions: {
        funnel,
        hub: hubCounts,
        overdueTotal,
      },
      growth: {
        newUsers: overview.commerce.current.newUsers,
        newListings: overview.commerce.current.newListings,
        listingPageviews,
        placedOrders: overview.commerce.current.placedOrders,
        realizedOrders: overview.commerce.current.realizedOrders,
        realizationRate,
      },
      finance: {
        gmv: overview.commerce.current.gmv,
        commission: overview.commerce.current.commission,
        profitWalletBalance: wallet.profitWallet.balance,
        userAvailable: wallet.systemWallet.available,
        userBlocked: wallet.systemWallet.blocked,
        pendingWithdraws: walletQueues.withdraws.count,
        pendingDeposits: walletQueues.deposits.count,
      },
      infra: {
        overallStatus: monitor.overallStatus,
        diskUsePercent: monitor.storage.disk?.usePercent ?? null,
        heapUsedMb: monitor.runtime.heapUsedMb,
        uptimeSec: monitor.runtime.nodeUptimeSec,
        backupLastStatus: monitor.backup.lastStatus,
        dbLatencyMs,
        issues: monitor.issues.slice(0, 3),
      },
      series: overview.series,
      topListings: overview.topListings.map((l) => ({
        id: l.id,
        title: l.title,
        thumbnail: l.thumbnail,
        pageviews: l.pageviews,
        visitors: l.visitors,
      })),
    };
  }

  // ——— listings ———

  private async listingStatusCounts() {
    const rows = await this.prisma.listing.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const m = new Map(rows.map((r) => [r.status, r._count._all]));
    const total = rows.reduce((n, r) => n + r._count._all, 0);
    return {
      total,
      active: m.get(ListingStatus.APPROVED) ?? 0,
      pending: m.get(ListingStatus.PENDING) ?? 0,
      rejected: m.get(ListingStatus.REJECTED) ?? 0,
      sold: m.get(ListingStatus.SOLD) ?? 0,
      draft: m.get(ListingStatus.DRAFT) ?? 0,
      archived: m.get(ListingStatus.ARCHIVED) ?? 0,
    };
  }

  private async listingExtraCounts(todayStart: Date) {
    const [newToday, noImages, viewedIds, withOffers] = await Promise.all([
      this.prisma.listing.count({ where: { createdAt: { gte: todayStart } } }),
      this.prisma.listing.count({
        where: {
          AND: [
            { OR: [{ thumbnail: null }, { thumbnail: '' }] },
            { gallery: { equals: [] } },
          ],
        },
      }),
      this.prisma.listingView.findMany({
        distinct: ['listingId'],
        select: { listingId: true },
      }),
      this.prisma.purchaseOffer.groupBy({
        by: ['listingId'],
        where: { status: PurchaseOfferStatus.PENDING },
      }),
    ]);
    const totalListings = await this.prisma.listing.count();
    return {
      newToday,
      noImages,
      noViews: Math.max(0, totalListings - viewedIds.length),
      withPendingPurchaseOffers: withOffers.length,
    };
  }

  private async countListingPageviews(from: Date): Promise<number> {
    return this.prisma.sitePageView.count({
      where: { viewedAt: { gte: from }, path: { startsWith: '/listing/' } },
    });
  }

  // ——— orders ———

  private async orderStatusCounts(): Promise<Map<OrderStatus, number>> {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.status, r._count._all]));
  }

  private async funnelWaitStats(now: Date): Promise<
    Map<OrderStatus, { avgWaitSec: number | null; maxWaitSec: number | null; overdueCount: number }>
  > {
    const stages: OrderStatus[] = [
      OrderStatus.PENDING,
      OrderStatus.AWAITING_PAYMENT,
      OrderStatus.PAID,
      OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      OrderStatus.SHIPPED_TO_HUB,
      OrderStatus.RECEIVED_AT_HUB,
      OrderStatus.CHECKING_AT_HUB,
      OrderStatus.VERIFIED_AT_HUB,
      OrderStatus.SHIPPED_TO_BUYER,
      OrderStatus.SHIPPED,
      OrderStatus.DELIVERED,
      OrderStatus.DISPUTED,
    ];

    const result = new Map<
      OrderStatus,
      { avgWaitSec: number | null; maxWaitSec: number | null; overdueCount: number }
    >();

    await Promise.all(
      stages.map(async (status) => {
        const rows = await this.prisma.order.findMany({
          where: { status },
          select: {
            updatedAt: true,
            shippingDeadline: true,
            buyerConfirmDeadline: true,
            returnConfirmDeadline: true,
          },
          take: 2000,
        });
        if (!rows.length) {
          result.set(status, { avgWaitSec: null, maxWaitSec: null, overdueCount: 0 });
          return;
        }
        const waits = rows.map((r) =>
          Math.max(0, Math.floor((now.getTime() - r.updatedAt.getTime()) / 1000)),
        );
        const avg = Math.round(waits.reduce((a, b) => a + b, 0) / waits.length);
        const max = Math.max(...waits);
        const overdueCount = rows.filter((r) => isOrderOverdue(r, now)).length;
        result.set(status, { avgWaitSec: avg, maxWaitSec: max, overdueCount });
      }),
    );

    return result;
  }

  private async countOverdueOrders(now: Date): Promise<number> {
    return this.prisma.order.count({
      where: {
        status: { in: OPEN_ORDER },
        OR: [
          { shippingDeadline: { lt: now } },
          { buyerConfirmDeadline: { lt: now } },
          { returnConfirmDeadline: { lt: now } },
        ],
      },
    });
  }

  private async countPaymentOverdue(now: Date): Promise<{ count: number; oldestAgeSec: number | null }> {
    const rows = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.AWAITING_PAYMENT,
        OR: [
          { shippingDeadline: { lt: now } },
          { buyerConfirmDeadline: { lt: now } },
        ],
      },
      select: { createdAt: true },
      orderBy: { createdAt: 'asc' },
      take: 1,
    });
    const count = await this.prisma.order.count({
      where: {
        status: OrderStatus.AWAITING_PAYMENT,
        OR: [
          { shippingDeadline: { lt: now } },
          { buyerConfirmDeadline: { lt: now } },
        ],
      },
    });
    const oldest = rows[0]?.createdAt;
    return {
      count,
      oldestAgeSec: oldest
        ? Math.max(0, Math.floor((now.getTime() - oldest.getTime()) / 1000))
        : null,
    };
  }

  private buildFunnel(
    counts: Map<OrderStatus, number>,
    hub: {
      awaitingShipmentToHub: number;
      shippedToHub: number;
      receivedAtHub: number;
      checkingAtHub: number;
      verifiedAtHub: number;
      shippedToBuyer: number;
    },
    waits: Awaited<ReturnType<AdminGodCommandService['funnelWaitStats']>>,
  ): GodFunnelStage[] {
    const stage = (
      key: string,
      label: string,
      status: OrderStatus | null,
      countOverride?: number,
    ): GodFunnelStage => {
      const w = status ? waits.get(status) : undefined;
      return {
        key,
        label,
        count: countOverride ?? (status ? counts.get(status) ?? 0 : 0),
        overdueCount: w?.overdueCount ?? 0,
        avgWaitSec: w?.avgWaitSec ?? null,
        maxWaitSec: w?.maxWaitSec ?? null,
      };
    };

    const hubTotal =
      hub.awaitingShipmentToHub +
      hub.shippedToHub +
      hub.receivedAtHub +
      hub.checkingAtHub +
      hub.verifiedAtHub;

    return [
      stage('pending', 'خرید جدید', OrderStatus.PENDING),
      stage('awaiting_payment', 'در انتظار پرداخت', OrderStatus.AWAITING_PAYMENT),
      stage('paid', 'پرداخت‌شده', OrderStatus.PAID),
      {
        key: 'hub',
        label: 'در هاب / کارشناسی',
        count: hubTotal,
        overdueCount:
          (waits.get(OrderStatus.RECEIVED_AT_HUB)?.overdueCount ?? 0) +
          (waits.get(OrderStatus.CHECKING_AT_HUB)?.overdueCount ?? 0),
        avgWaitSec: null,
        maxWaitSec: null,
      },
      stage('shipped', 'ارسال / تحویل', OrderStatus.SHIPPED_TO_BUYER, 
        (counts.get(OrderStatus.SHIPPED_TO_BUYER) ?? 0) +
        (counts.get(OrderStatus.SHIPPED) ?? 0) +
        (counts.get(OrderStatus.DELIVERED) ?? 0),
      ),
      stage('completed', 'تکمیل', OrderStatus.COMPLETED),
      stage('disputed', 'اختلاف', OrderStatus.DISPUTED),
      stage('cancelled', 'لغو', OrderStatus.CANCELLED),
    ];
  }

  // ——— wallet / contact ———

  private async walletQueueStats() {
    const [withdraws, deposits] = await Promise.all([
      this.oldestAndCount(
        this.prisma.walletTransaction,
        {
          type: WalletTransactionType.WITHDRAW_REQUEST,
          status: WalletTransactionStatus.PENDING,
        },
        'createdAt',
      ),
      this.oldestAndCount(
        this.prisma.walletTransaction,
        {
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          meta: { path: ['kind'], equals: MANUAL_DEPOSIT_KIND },
        },
        'createdAt',
      ),
    ]);
    return { withdraws, deposits };
  }

  private async contactUnreadStats(): Promise<{
    count: number;
    unreadCount: number;
    oldestAgeSec: number | null;
  }> {
    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { startsWith: 'CONTACT_MESSAGE_' } },
      select: { value: true, updatedAt: true },
    });
    const now = Date.now();
    let unread = 0;
    let oldest: number | null = null;
    for (const row of rows) {
      try {
        const parsed = JSON.parse(row.value || '{}') as {
          isRead?: boolean;
          createdAt?: string;
        };
        if (parsed.isRead === true) continue;
        unread += 1;
        const ts = parsed.createdAt
          ? new Date(parsed.createdAt).getTime()
          : row.updatedAt.getTime();
        if (!Number.isNaN(ts)) {
          const age = Math.max(0, Math.floor((now - ts) / 1000));
          oldest = oldest == null ? age : Math.max(oldest, age);
        }
      } catch {
        unread += 1;
      }
    }
    return { count: unread, unreadCount: unread, oldestAgeSec: oldest };
  }

  // ——— inbox ———

  private buildInbox(q: {
    disputes: { count: number; oldestAgeSec: number | null };
    awaitingPayment: { count: number; oldestAgeSec: number | null };
    paymentOverdue: { count: number; oldestAgeSec: number | null };
    hubActionable: { count: number; oldestAgeSec: number | null };
    withdraws: { count: number; oldestAgeSec: number | null };
    deposits: { count: number; oldestAgeSec: number | null };
    tickets: { count: number; oldestAgeSec: number | null };
    contact: { count: number; unreadCount: number; oldestAgeSec: number | null };
    crmOverdue: { count: number; oldestAgeSec: number | null };
    listingsPending: { count: number; oldestAgeSec: number | null };
    productRequests: { count: number; oldestAgeSec: number | null };
    purchaseOffers: { count: number; oldestAgeSec: number | null };
    repairs: { count: number; oldestAgeSec: number | null };
    merges: { count: number; oldestAgeSec: number | null };
    kyc: { count: number; oldestAgeSec: number | null };
    crmDue: { count: number; oldestAgeSec: number | null };
    overdueTotal: number;
  }): GodInboxItem[] {
    const items: GodInboxItem[] = [
      item('disputes', 'اختلاف سفارش', q.disputes.count, null, q.disputes.oldestAgeSec, 'critical', 'orders', { status: 'DISPUTED' }),
      item('payment_overdue', 'پرداخت سررسید گذشته', q.paymentOverdue.count, null, q.paymentOverdue.oldestAgeSec, 'critical', 'orders', { status: 'AWAITING_PAYMENT' }),
      item('overdue_orders', 'تراکنش سررسید گذشته', q.overdueTotal, null, null, 'critical', 'orders'),
      item('hub_action', 'کارشناسی هاب', q.hubActionable.count, null, q.hubActionable.oldestAgeSec, 'critical', 'inspection-orders'),
      item('withdrawals', 'درخواست برداشت', q.withdraws.count, null, q.withdraws.oldestAgeSec, 'financial', 'wallet-requests', { tab: 'withdrawals', status: 'PENDING' }),
      item('deposits', 'واریز دستی', q.deposits.count, null, q.deposits.oldestAgeSec, 'financial', 'wallet-requests', { tab: 'deposits', status: 'PENDING' }),
      item('awaiting_payment', 'در انتظار پرداخت', q.awaitingPayment.count, null, q.awaitingPayment.oldestAgeSec, 'financial', 'orders', { status: 'AWAITING_PAYMENT' }),
      item('tickets', 'تیکت باز', q.tickets.count, null, q.tickets.oldestAgeSec, 'overdue', 'tickets', { status: 'OPEN' }),
      item('contact', 'پیام تماس', q.contact.count, q.contact.unreadCount, q.contact.oldestAgeSec, 'overdue', 'contact-messages'),
      item('crm_overdue', 'پیگیری فروشنده معوق', q.crmOverdue.count, null, q.crmOverdue.oldestAgeSec, 'overdue', 'seller-crm'),
      item('listings_pending', 'آگهی در انتظار تایید', q.listingsPending.count, null, q.listingsPending.oldestAgeSec, 'listings', 'listings', { status: 'PENDING' }),
      item('product_requests', 'درخواست محصول', q.productRequests.count, null, q.productRequests.oldestAgeSec, 'listings', 'product-requests'),
      item('purchase_offers', 'پیشنهاد خرید', q.purchaseOffers.count, null, q.purchaseOffers.oldestAgeSec, 'listings', 'listings'),
      item('repairs', 'درخواست تعمیر', q.repairs.count, null, q.repairs.oldestAgeSec, 'routine', 'repair-requests', { status: 'PENDING_REVIEW' }),
      item('merges', 'درخواست ادغام', q.merges.count, null, q.merges.oldestAgeSec, 'routine', 'listing-merge-requests'),
      item('kyc', 'احراز هویت', q.kyc.count, null, q.kyc.oldestAgeSec, 'routine', 'users', { status: 'PENDING' }),
      item('crm_due', 'پیگیری فروشنده امروز', q.crmDue.count, null, q.crmDue.oldestAgeSec, 'routine', 'seller-crm'),
    ];

    return items
      .filter((i) => i.count > 0)
      .sort(
        (a, b) =>
          SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
          b.count - a.count ||
          (b.oldestAgeSec ?? 0) - (a.oldestAgeSec ?? 0),
      );
  }

  // ——— helpers ———

  private async oldestAndCount(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    model: { count: (args: any) => Promise<number>; findFirst: (args: any) => Promise<any> },
    where: Record<string, unknown>,
    dateField: string,
  ): Promise<{ count: number; oldestAgeSec: number | null }> {
    const [count, oldest] = await Promise.all([
      model.count({ where }),
      model.findFirst({
        where,
        orderBy: { [dateField]: 'asc' },
        select: { [dateField]: true },
      }),
    ]);
    const raw = oldest?.[dateField] as Date | null | undefined;
    const oldestAgeSec =
      raw instanceof Date
        ? Math.max(0, Math.floor((Date.now() - raw.getTime()) / 1000))
        : null;
    return { count, oldestAgeSec };
  }
}

function item(
  key: string,
  label: string,
  count: number,
  unreadCount: number | null,
  oldestAgeSec: number | null,
  severity: GodInboxSeverity,
  link: string,
  query?: Record<string, string>,
): GodInboxItem {
  return { key, label, count, unreadCount, oldestAgeSec, severity, link, query };
}

function tehranDayStart(now: Date): Date {
  const local = now.getTime() + TEHRAN_OFFSET_MS;
  return new Date(Math.floor(local / DAY_MS) * DAY_MS - TEHRAN_OFFSET_MS);
}

function rangeWindowStart(range: GodRange, now: Date): Date {
  if (range === '24h') {
    const hour = 60 * 60 * 1000;
    const hourStart = new Date(Math.floor(now.getTime() / hour) * hour);
    return new Date(hourStart.getTime() - 23 * hour);
  }
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  return new Date(tehranDayStart(now).getTime() - (days - 1) * DAY_MS);
}

function startOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfLocalDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

function isOrderOverdue(
  r: {
    shippingDeadline: Date | null;
    buyerConfirmDeadline: Date | null;
    returnConfirmDeadline: Date | null;
  },
  now: Date,
): boolean {
  return (
    (!!r.shippingDeadline && r.shippingDeadline < now) ||
    (!!r.buyerConfirmDeadline && r.buyerConfirmDeadline < now) ||
    (!!r.returnConfirmDeadline && r.returnConfirmDeadline < now)
  );
}

function parseLatencyMs(detail?: string): number | null {
  if (!detail) return null;
  const m = /latency\s+(\d+)\s*ms/i.exec(detail);
  return m ? Number(m[1]) : null;
}
