import type { GodRange } from './admin-god-dashboard.service';

export type GodInboxSeverity = 'critical' | 'financial' | 'overdue' | 'listings' | 'routine';

export interface GodInboxItem {
  key: string;
  label: string;
  count: number;
  unreadCount: number | null;
  oldestAgeSec: number | null;
  severity: GodInboxSeverity;
  link: string;
  query?: Record<string, string>;
}

export interface GodFunnelStage {
  key: string;
  label: string;
  count: number;
  overdueCount: number;
  avgWaitSec: number | null;
  maxWaitSec: number | null;
}

export interface GodCommand {
  header: {
    generatedAt: string;
    range: GodRange;
    from: string;
    to: string;
    online: number;
    systemOverallStatus: 'ok' | 'warning' | 'critical' | 'unknown';
  };
  kpis: {
    activeListings: number;
    newListingsInRange: number;
    activeTransactions: number;
    successfulInRange: number;
    collectedCommissionInRange: number;
    pendingActionsTotal: number;
  };
  inbox: GodInboxItem[];
  listings: {
    total: number;
    active: number;
    pending: number;
    rejected: number;
    sold: number;
    draft: number;
    archived: number;
    newToday: number;
    noImages: number;
    noViews: number;
    withPendingPurchaseOffers: number;
  };
  transactions: {
    funnel: GodFunnelStage[];
    hub: {
      awaitingShipmentToHub: number;
      shippedToHub: number;
      receivedAtHub: number;
      checkingAtHub: number;
      verifiedAtHub: number;
      shippedToBuyer: number;
    };
    overdueTotal: number;
  };
  growth: {
    newUsers: number;
    newListings: number;
    listingPageviews: number;
    placedOrders: number;
    realizedOrders: number;
    /** realized / placed when placed > 0 */
    realizationRate: number | null;
  };
  finance: {
    gmv: number;
    commission: number;
    profitWalletBalance: number;
    userAvailable: number;
    userBlocked: number;
    pendingWithdraws: number;
    pendingDeposits: number;
  };
  infra: {
    overallStatus: 'ok' | 'warning' | 'critical' | 'unknown';
    diskUsePercent: number | null;
    heapUsedMb: number;
    uptimeSec: number;
    backupLastStatus: string | null;
    dbLatencyMs: number | null;
    issues: string[];
  };
  series: Array<{
    key: string;
    pageviews: number;
    sessions: number;
    gmv: number;
    orders: number;
  }>;
  topListings: Array<{
    id: string;
    title: string;
    thumbnail: string | null;
    pageviews: number;
    visitors: number;
  }>;
}
