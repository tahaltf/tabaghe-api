import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import {
  AuctionStatus,
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
  RepairRequestStatus,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { appendJsonLog } from '../../common/logging/app-log.util';
import { NotificationService } from '../notification/notification.service';
import { SETTING_KEYS } from '../admin/services/admin-settings.service';
import { ReferralService } from '../referral/referral.service';
import type { UserReferralInfo } from '../referral/referral.service';
import { UserPanelAccessService } from './user-panel-access.service';
import type { UserPanelAccessMap } from './config/user-panel-access.registry';
import { ensureUserShopSlug } from '../../common/user/shop-slug.util';
import {
  isFinancialVerified,
  isIdentityVerified,
  maskBankCardNumber,
} from '../../common/kyc/kyc-profile.util';
import { isZohalServiceFailure } from '../zohal/zohal.errors';
import { ZohalService } from '../zohal/zohal.service';
import { ZohalSettingsService } from '../zohal/zohal-settings.service';
import type { KycFormConfig } from '../zohal/zohal-settings.constants';
import { AdminUsersService } from './admin-users.service';
import { InquiryRestrictionService } from '../zohal/inquiry-restriction.service';
import type { InquiryRestrictionSnapshot } from '../zohal/inquiry-restriction.service';

const MY_PROFILE_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  nationalCode: true,
  shabaNumber: true,
  bankCardNumber: true,
  bankCardBin: true,
  bankName: true,
  financialVerifiedAt: true,
  nationalCardImage: true,
  avatar: true,
  bio: true,
  shopSlug: true,
  notifyEmail: true,
  notifySms: true,
  notifyPush: true,
  status: true,
  role: true,
  isVerified: true,
  rating: true,
  trustScore: true,
  kycRejectionReason: true,
  kycReviewedAt: true,
  birthDate: true,
  inviteCode: true,
  referredById: true,
  panelAccess: true,
  allowedListingCurrencyCodes: true,
  termsAcceptedAt: true,
  termsAcceptedVersion: true,
  sellerTermsAcceptedAt: true,
  sellerTermsAcceptedVersion: true,
} satisfies Prisma.UserSelect;

export type MyProfile = Omit<
  Prisma.UserGetPayload<{ select: typeof MY_PROFILE_SELECT }>,
  'bankCardNumber'
> & {
  panelAccess: UserPanelAccessMap;
  bankCardMasked: string | null;
  kyc: {
    identityVerified: boolean;
    financialVerified: boolean;
  };
  bankAccounts: Array<{
    id: string;
    label: string | null;
    bankName: string | null;
    bankCardMasked: string | null;
    shabaNumber: string | null;
    isDefault: boolean;
    verifiedAt: Date | null;
  }>;
  defaultBankAccountId: string | null;
  inquiryRestriction: InquiryRestrictionSnapshot;
};

export interface DashboardStats {
  activeAuctions: number;
  highestBidderCount: number;
  wonBids: number;
  exchangeOffersReceived: number;
  balanceBlocked: Prisma.Decimal | number;
  balanceAvailable: Prisma.Decimal | number;
  activeListings: number;
  remainingQuota: number;
  kpis: {
    activeListings: DashboardKpiDelta;
    exchangeOffersReceived: DashboardKpiDelta;
    activeAuctions: DashboardKpiDelta;
    balanceBlocked: DashboardKpiDelta;
  };
}

export type DashboardKpiTrend = 'up' | 'down' | 'flat';

export interface DashboardKpiDelta {
  current: number;
  previous: number;
  delta: number;
  deltaPercent: number;
  trend: DashboardKpiTrend;
  windowDays: number;
}

export type DashboardInsightsDay = {
  date: string;
  label: string;
  views: number;
};

export type DashboardInsightsListing = {
  id: string;
  title: string;
  views: number;
};

export type DashboardPieSlice = {
  key: string;
  label: string;
  value: number;
};

export type DashboardRepairLatest = {
  id: string;
  brand: string;
  model: string;
  status: RepairRequestStatus;
  trackingCode: string;
};

export type DashboardInsights = {
  windowDays: number;
  views: number;
  viewsPrevious: number;
  saves: number;
  messages: number;
  days: DashboardInsightsDay[];
  topListings: DashboardInsightsListing[];
  salesAmount: number;
  salesCount: number;
  salesByType: DashboardPieSlice[];
  listingsByType: DashboardPieSlice[];
  repairs: {
    total: number;
    active: number;
    latest: DashboardRepairLatest | null;
  };
};

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  [OrderType.DIRECT]: 'فروش مستقیم',
  [OrderType.AUCTION]: 'مزایده',
  [OrderType.EXCHANGE]: 'معاوضه',
};

const LISTING_TYPE_LABELS: Record<ListingType, string> = {
  [ListingType.DIRECT]: 'مستقیم',
  [ListingType.AUCTION]: 'مزایده',
  [ListingType.EXCHANGE]: 'معاوضه',
};

const REPAIR_INACTIVE_STATUSES: RepairRequestStatus[] = [
  RepairRequestStatus.COMPLETED,
  RepairRequestStatus.CANCELLED,
  RepairRequestStatus.REJECTED,
];

export type PanelBadgeSection =
  | 'listing'
  | 'buy'
  | 'sell'
  | 'requests'
  | 'ticket'
  | 'repairs';

export type PanelBadges = Record<PanelBadgeSection, number>;

export type TelegramLinkStatus = {
  linked: boolean;
  telegramId: string | null;
  hasToken: boolean;
};

export type GeneratedTelegramToken = {
  token: string;
  startCommand: string;
  deepLinkUrl: string | null;
};

const REQUEST_NOTIFICATION_TYPES: NotificationType[] = [
  NotificationType.EXCHANGE_OFFER_RECEIVED,
  NotificationType.EXCHANGE_OFFER_ACCEPTED,
  NotificationType.EXCHANGE_OFFER_REJECTED,
  NotificationType.PURCHASE_OFFER_RECEIVED,
  NotificationType.PURCHASE_OFFER_ACCEPTED,
  NotificationType.PURCHASE_OFFER_REJECTED,
  NotificationType.AUCTION_WON,
  NotificationType.AUCTION_LOST,
  NotificationType.AUCTION_PAYMENT_REMINDER,
  NotificationType.ACTION_DEADLINE_REMINDER,
  NotificationType.AUCTION_PENALIZED,
  NotificationType.BUY_NOW,
];

/** سفارش‌هایی که دیگر نیازی به پیگیری در badge خرید/فروش نیست */
const TERMINAL_ORDER_STATUSES_FOR_BADGE: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.CANCELLED,
];

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly referralService: ReferralService,
    private readonly panelAccessService: UserPanelAccessService,
    private readonly zohal: ZohalService,
    private readonly zohalSettings: ZohalSettingsService,
    private readonly adminUsers: AdminUsersService,
    private readonly inquiryRestrictions: InquiryRestrictionService,
  ) {}

  async getKycFormConfig(): Promise<KycFormConfig> {
    return this.zohalSettings.getKycFormConfig();
  }

  async getMe(userId: string): Promise<MyProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: MY_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const shopSlug = await ensureUserShopSlug(this.prisma, user);
    return this.toProfile({ ...user, shopSlug });
  }

  private async toProfile(
    user: Prisma.UserGetPayload<{ select: typeof MY_PROFILE_SELECT }>,
  ): Promise<MyProfile> {
    const { panelAccess: raw, ...profile } = user;
    const aiEnabledRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'AI_ENABLED' },
    });
    const aiEnabled = ['1', 'true', 'yes', 'on'].includes(
      (aiEnabledRow?.value ?? 'false').trim().toLowerCase(),
    );
    const baseAccess = this.panelAccessService.resolveMap(raw, {
      aiContentDefault: aiEnabled,
    });
    const [settings, restrictedPanelAccess, bankAccountRows, inquiryRestriction] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'KYC_REQUIRE_IDENTITY_FOR_ORDERS',
              'KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW',
            ],
          },
        },
        select: { key: true, value: true },
      }),
      Promise.resolve(baseAccess),
      this.prisma.userBankAccount.findMany({
        where: { userId: user.id, deletedAt: null },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      }),
      this.inquiryRestrictions.getSnapshot(user.id),
    ]);
    const settingsMap: Record<string, string> = {};
    for (const item of settings) settingsMap[item.key] = item.value;
    const identityOk = isIdentityVerified(user);
    const hasApprovedBank = bankAccountRows.some(
      (a) => a.verificationStatus === 'APPROVED',
    );
    const financialOk = hasApprovedBank || isFinancialVerified(user);
    const requireIdentityForOrders =
      String(settingsMap.KYC_REQUIRE_IDENTITY_FOR_ORDERS ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWithdraw =
      String(settingsMap.KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW ?? 'true').toLowerCase() !==
      'false';
    if (requireIdentityForOrders && !identityOk) {
      restrictedPanelAccess['dashboard.orders'] = false;
    }
    if (requireFinancialForWithdraw && !financialOk) {
      restrictedPanelAccess['dashboard.wallet.withdraw'] = false;
    }
    const { bankCardNumber, ...publicProfile } = profile;
    const defaultAccount = bankAccountRows.find((a) => a.isDefault) ?? bankAccountRows[0] ?? null;
    return {
      ...publicProfile,
      bankCardMasked: bankCardNumber ? maskBankCardNumber(bankCardNumber) : null,
      kyc: {
        identityVerified: identityOk,
        financialVerified: financialOk,
      },
      bankAccounts: bankAccountRows.map((a) => ({
        id: a.id,
        label: a.label,
        bankName: a.bankName,
        bankCardMasked: a.bankCardNumber ? maskBankCardNumber(a.bankCardNumber) : null,
        shabaNumber: a.shabaNumber,
        isDefault: a.isDefault,
        verificationStatus: a.verificationStatus,
        rejectionReason: a.rejectionReason,
        verifiedAt: a.verifiedAt,
      })),
      defaultBankAccountId: defaultAccount?.id ?? null,
      inquiryRestriction,
      panelAccess: restrictedPanelAccess,
    };
  }

  async getReferralInfo(userId: string): Promise<UserReferralInfo> {
    return this.referralService.getReferralInfo(userId);
  }

  async getTelegramLinkStatus(userId: string): Promise<TelegramLinkStatus> {
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { telegramId: true, telegramToken: true, isActive: true },
    });
    if (!row || !row.isActive) throw new NotFoundException('کاربر یافت نشد');
    return {
      linked: !!row.telegramId,
      telegramId: row.telegramId ?? null,
      hasToken: !!row.telegramToken,
    };
  }

  async generateTelegramLinkToken(userId: string): Promise<GeneratedTelegramToken> {
    // short, URL-safe token; stored in DB and consumed by /start <token>
    for (let attempt = 0; attempt < 5; attempt++) {
      const token = randomBytes(24).toString('base64url');
      try {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            telegramToken: token,
          },
          select: { id: true },
        });

        const usernameRow = await this.prisma.systemSetting.findUnique({
          where: { key: SETTING_KEYS.TELEGRAM_BOT_USERNAME },
          select: { value: true },
        });
        const username = String(usernameRow?.value ?? '')
          .trim()
          .replace(/^@/, '');
        const deepLinkUrl = username
          ? `https://t.me/${encodeURIComponent(username)}?start=${encodeURIComponent(token)}`
          : null;

        return {
          token,
          startCommand: `/start ${token}`,
          deepLinkUrl,
        };
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002'
        ) {
          // token collision (extremely unlikely) or existing unique constraint conflict; retry
          continue;
        }
        throw err;
      }
    }
    throw new BadRequestException('ساخت توکن ناموفق بود؛ دوباره تلاش کنید.');
  }

  async unlinkTelegram(userId: string): Promise<{ ok: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        telegramId: null,
        telegramToken: null,
      },
      select: { id: true },
    });
    return { ok: true };
  }

  async getDashboardStats(userId: string): Promise<DashboardStats> {
    const windowDays = 30;
    const now = new Date();
    const currentFrom = new Date(now);
    currentFrom.setDate(now.getDate() - windowDays);
    const previousFrom = new Date(currentFrom);
    previousFrom.setDate(currentFrom.getDate() - windowDays);

    const toKpiDelta = (current: number, previous: number): DashboardKpiDelta => {
      const safeCurrent = Number.isFinite(current) ? current : 0;
      const safePrevious = Number.isFinite(previous) ? previous : 0;
      const delta = safeCurrent - safePrevious;
      const deltaPercent =
        safePrevious === 0
          ? (safeCurrent === 0 ? 0 : 100)
          : Number(((delta / safePrevious) * 100).toFixed(1));
      const trend: DashboardKpiTrend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
      return {
        current: safeCurrent,
        previous: safePrevious,
        delta,
        deltaPercent,
        trend,
        windowDays,
      };
    };

    const [
      activeBids,
      finishedBids,
      exchangeOffersReceived,
      activeListings,
      wallet,
      activeListingsCurrentWindow,
      activeListingsPreviousWindow,
      exchangeOffersCurrentWindow,
      exchangeOffersPreviousWindow,
      auctionBidsCurrentWindow,
      auctionBidsPreviousWindow,
    ] = await Promise.all([
      this.prisma.auctionBid.findMany({
        where: { bidderId: userId, auction: { status: AuctionStatus.ACTIVE } },
        distinct: ['listingId'],
        include: {
          auction: {
            include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
          },
        },
      }),
      this.prisma.auctionBid.findMany({
        where: {
          bidderId: userId,
          auction: { status: AuctionStatus.FINISHED },
        },
        distinct: ['listingId'],
        include: {
          auction: {
            include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
          },
        },
      }),
      this.prisma.exchangeOffer.count({
        where: {
          listing: { authorId: userId },
          status: {
            in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
          },
        },
      }),
      this.prisma.listing.count({
        where: { authorId: userId, status: ListingStatus.APPROVED },
      }),
      this.prisma.wallet.findUnique({ where: { userId } }),
      this.prisma.listing.count({
        where: {
          authorId: userId,
          status: ListingStatus.APPROVED,
          createdAt: { gte: currentFrom, lt: now },
        },
      }),
      this.prisma.listing.count({
        where: {
          authorId: userId,
          status: ListingStatus.APPROVED,
          createdAt: { gte: previousFrom, lt: currentFrom },
        },
      }),
      this.prisma.exchangeOffer.count({
        where: {
          listing: { authorId: userId },
          createdAt: { gte: currentFrom, lt: now },
          status: {
            in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
          },
        },
      }),
      this.prisma.exchangeOffer.count({
        where: {
          listing: { authorId: userId },
          createdAt: { gte: previousFrom, lt: currentFrom },
          status: {
            in: [ExchangeOfferStatus.PENDING, ExchangeOfferStatus.WAITLISTED],
          },
        },
      }),
      this.prisma.auctionBid.count({
        where: {
          bidderId: userId,
          createdAt: { gte: currentFrom, lt: now },
        },
      }),
      this.prisma.auctionBid.count({
        where: {
          bidderId: userId,
          createdAt: { gte: previousFrom, lt: currentFrom },
        },
      }),
    ]);

    const highestBidderCount = activeBids.reduce((acc, bid) => {
      const topBid = bid.auction?.bids[0];
      return topBid && topBid.bidderId === userId ? acc + 1 : acc;
    }, 0);

    const wonBidsCount = finishedBids.reduce(
      (acc, bid) => (bid.auction?.bids[0]?.bidderId === userId ? acc + 1 : acc),
      0,
    );

    return {
      activeAuctions: activeBids.length,
      highestBidderCount,
      wonBids: wonBidsCount,
      exchangeOffersReceived,
      balanceBlocked: wallet?.balanceBlocked ?? 0,
      balanceAvailable: wallet?.balanceAvailable ?? 0,
      activeListings,
      // سهمیه آگهی فعلا در محصول غیرفعال است.
      remainingQuota: 0,
      kpis: {
        activeListings: toKpiDelta(activeListingsCurrentWindow, activeListingsPreviousWindow),
        exchangeOffersReceived: toKpiDelta(exchangeOffersCurrentWindow, exchangeOffersPreviousWindow),
        activeAuctions: toKpiDelta(auctionBidsCurrentWindow, auctionBidsPreviousWindow),
        balanceBlocked: toKpiDelta(Number(wallet?.balanceBlocked ?? 0), Number(wallet?.balanceBlocked ?? 0)),
      },
    };
  }

  async getDashboardInsights(userId: string, windowDays = 7): Promise<DashboardInsights> {
    const daysCount = windowDays === 14 ? 14 : 7;
    const tz = 'Asia/Tehran';
    const now = new Date();
    const dayKey = (d: Date) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(d);
    const weekdayLabel = (iso: string) =>
      new Intl.DateTimeFormat('fa-IR', {
        timeZone: tz,
        weekday: 'short',
      }).format(new Date(`${iso}T12:00:00+03:30`));

    const keys: string[] = [];
    for (let i = daysCount - 1; i >= 0; i -= 1) {
      keys.push(dayKey(new Date(now.getTime() - i * 86_400_000)));
    }
    const since = new Date(now.getTime() - (daysCount - 1) * 86_400_000);
    since.setHours(0, 0, 0, 0);
    const previousFrom = new Date(since.getTime() - daysCount * 86_400_000);

    const emptyDays: DashboardInsightsDay[] = keys.map((date) => ({
      date,
      label: weekdayLabel(date),
      views: 0,
    }));

    const listingRows = await this.prisma.listing.findMany({
      where: { authorId: userId },
      select: { id: true, type: true, status: true },
    });
    const listingIds = listingRows.map((row) => row.id);
    const hasListings = listingIds.length > 0;

    const [
      viewsRows,
      viewsPrevious,
      saves,
      messages,
      grouped,
      salesAgg,
      salesByTypeRows,
      repairLatest,
      repairGroups,
    ] = await Promise.all([
      hasListings
        ? this.prisma.listingView.findMany({
            where: { listingId: { in: listingIds }, viewedAt: { gte: since } },
            select: { viewedAt: true, listingId: true },
          })
        : Promise.resolve([]),
      hasListings
        ? this.prisma.listingView.count({
            where: {
              listingId: { in: listingIds },
              viewedAt: { gte: previousFrom, lt: since },
            },
          })
        : Promise.resolve(0),
      hasListings
        ? this.prisma.savedListing.count({
            where: { listing: { authorId: userId }, createdAt: { gte: since } },
          })
        : Promise.resolve(0),
      hasListings
        ? this.prisma.message.count({
            where: {
              conversation: { listing: { authorId: userId } },
              senderId: { not: userId },
              createdAt: { gte: since },
            },
          })
        : Promise.resolve(0),
      hasListings
        ? this.prisma.listingView.groupBy({
            by: ['listingId'],
            where: { listingId: { in: listingIds }, viewedAt: { gte: since } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.prisma.order.aggregate({
        where: { sellerId: userId, status: OrderStatus.COMPLETED },
        _sum: { sellerRevenue: true },
        _count: true,
      }),
      this.prisma.order.groupBy({
        by: ['type'],
        where: { sellerId: userId, status: OrderStatus.COMPLETED },
        _sum: { sellerRevenue: true },
      }),
      this.prisma.repairRequest.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          brand: true,
          model: true,
          status: true,
          trackingCode: true,
        },
      }),
      this.prisma.repairRequest.groupBy({
        by: ['status'],
        where: { userId },
        _count: { _all: true },
      }),
    ]);

    const byDay = new Map(keys.map((key) => [key, 0]));
    for (const row of viewsRows) {
      const key = dayKey(row.viewedAt);
      if (byDay.has(key)) {
        byDay.set(key, (byDay.get(key) ?? 0) + 1);
      }
    }

    const topIds = [...grouped]
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, 3);
    const listings = topIds.length
      ? await this.prisma.listing.findMany({
          where: { id: { in: topIds.map((row) => row.listingId) } },
          select: { id: true, title: true },
        })
      : [];
    const listingMap = new Map(listings.map((row) => [row.id, row.title]));

    const salesByTypeMap = new Map(
      salesByTypeRows.map((row) => [row.type, Number(row._sum.sellerRevenue ?? 0)]),
    );
    const salesByType: DashboardPieSlice[] = [
      OrderType.DIRECT,
      OrderType.AUCTION,
      OrderType.EXCHANGE,
    ].map((type) => ({
      key: type,
      label: ORDER_TYPE_LABELS[type],
      value: salesByTypeMap.get(type) ?? 0,
    }));

    const listingCountByType = new Map<ListingType, number>();
    for (const row of listingRows) {
      if (row.status !== ListingStatus.APPROVED) continue;
      listingCountByType.set(row.type, (listingCountByType.get(row.type) ?? 0) + 1);
    }
    const listingsByType: DashboardPieSlice[] = [
      ListingType.DIRECT,
      ListingType.AUCTION,
      ListingType.EXCHANGE,
    ].map((type) => ({
      key: type,
      label: LISTING_TYPE_LABELS[type],
      value: listingCountByType.get(type) ?? 0,
    }));

    const repairTotal = repairGroups.reduce((acc, row) => acc + row._count._all, 0);
    const repairActive = repairGroups
      .filter((row) => !REPAIR_INACTIVE_STATUSES.includes(row.status))
      .reduce((acc, row) => acc + row._count._all, 0);

    return {
      windowDays: daysCount,
      views: viewsRows.length,
      viewsPrevious,
      saves,
      messages,
      days: hasListings
        ? keys.map((date) => ({
            date,
            label: weekdayLabel(date),
            views: byDay.get(date) ?? 0,
          }))
        : emptyDays,
      topListings: topIds.map((row) => ({
        id: row.listingId,
        title: listingMap.get(row.listingId) || 'آگهی',
        views: row._count._all,
      })),
      salesAmount: Number(salesAgg._sum.sellerRevenue ?? 0),
      salesCount: Number(salesAgg._count ?? 0),
      salesByType,
      listingsByType,
      repairs: {
        total: repairTotal,
        active: repairActive,
        latest: repairLatest,
      },
    };
  }

  /**
   * شمارش badge منوی پنل: هر سفارش حداکثر یک‌بار در خرید یا فروش (نه تعداد خام اعلان‌ها).
   */
  async getPanelBadges(
    userId: string,
    sectionSeenAt: Partial<Record<PanelBadgeSection, number>> = {},
  ): Promise<PanelBadges> {
    const unread = await this.prisma.notification.findMany({
      where: { userId, isRead: false },
      select: { id: true, type: true, meta: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const orderMetaById = await this.loadOrderMetaForNotifications(
      userId,
      unread,
    );

    const keysBySection: Record<PanelBadgeSection, Set<string>> = {
      listing: new Set(),
      buy: new Set(),
      sell: new Set(),
      requests: new Set(),
      ticket: new Set(),
      repairs: new Set(),
    };

    for (const n of unread) {
      const meta = (n.meta ?? {}) as Record<string, unknown>;
      const section = this.resolvePanelBadgeSection(
        userId,
        n.type,
        meta,
        orderMetaById,
      );
      if (!section) continue;

      const seenAt = sectionSeenAt[section];
      if (seenAt) {
        const createdAt = new Date(n.createdAt).getTime();
        if (Number.isFinite(createdAt) && createdAt <= seenAt) continue;
      }

      const dedupeKey = this.panelBadgeDedupeKey(n.type, meta, n.id);
      keysBySection[section].add(dedupeKey);
    }

    return {
      listing: keysBySection.listing.size,
      buy: keysBySection.buy.size,
      sell: keysBySection.sell.size,
      requests: keysBySection.requests.size,
      ticket: keysBySection.ticket.size,
      repairs: keysBySection.repairs.size,
    };
  }

  /** با ورود کاربر به یک بخش پنل، اعلان‌های همان بخش خوانده می‌شوند. */
  async markPanelSectionSeen(
    userId: string,
    section: PanelBadgeSection,
  ): Promise<{ marked: number }> {
    const unread = await this.prisma.notification.findMany({
      where: { userId, isRead: false },
      select: { id: true, type: true, meta: true },
      take: 500,
    });
    const orderMetaById = await this.loadOrderMetaForNotifications(
      userId,
      unread,
    );

    const ids: string[] = [];
    for (const n of unread) {
      const meta = (n.meta ?? {}) as Record<string, unknown>;
      const resolved = this.resolvePanelBadgeSection(
        userId,
        n.type,
        meta,
        orderMetaById,
      );
      if (resolved === section) ids.push(n.id);
    }

    if (ids.length === 0) return { marked: 0 };

    const result = await this.prisma.notification.updateMany({
      where: { id: { in: ids }, userId, isRead: false },
      data: { isRead: true },
    });
    return { marked: result.count };
  }

  private async loadOrderMetaForNotifications(
    userId: string,
    notifications: Array<{ type: NotificationType; meta: unknown }>,
  ): Promise<
    Map<
      string,
      {
        buyerId: string;
        sellerId: string;
        status: OrderStatus;
        type: string;
      }
    >
  > {
    const orderIds = [
      ...new Set(
        notifications
          .filter((n) => n.type === NotificationType.ORDER_STATUS_CHANGED)
          .map((n) => {
            const meta = (n.meta ?? {}) as Record<string, unknown>;
            return String(meta['orderId'] ?? '').trim();
          })
          .filter(Boolean),
      ),
    ];

    const map = new Map<
      string,
      {
        buyerId: string;
        sellerId: string;
        status: OrderStatus;
        type: string;
      }
    >();
    if (orderIds.length === 0) return map;

    const orders = await this.prisma.order.findMany({
      where: {
        id: { in: orderIds },
        OR: [{ buyerId: userId }, { sellerId: userId }],
      },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        status: true,
        type: true,
      },
    });
    for (const o of orders) {
      map.set(o.id, {
        buyerId: o.buyerId,
        sellerId: o.sellerId,
        status: o.status,
        type: o.type,
      });
    }
    return map;
  }

  private panelBadgeDedupeKey(
    type: NotificationType,
    meta: Record<string, unknown>,
    notificationId: string,
  ): string {
    if (type === NotificationType.ORDER_STATUS_CHANGED) {
      const orderId = String(meta['orderId'] ?? '').trim();
      if (orderId) return `order:${orderId}`;
    }
    const offerId = String(
      meta['exchangeOfferId'] ?? meta['offerId'] ?? '',
    ).trim();
    if (offerId) return `offer:${offerId}`;
    const listingId = String(meta['listingId'] ?? '').trim();
    if (listingId && type !== NotificationType.ORDER_STATUS_CHANGED) {
      return `listing:${listingId}:${type}`;
    }
    const ticketId = String(meta['ticketId'] ?? '').trim();
    if (ticketId) return `ticket:${ticketId}`;
    const repairId = String(
      meta['repairRequestId'] ?? meta['repairId'] ?? '',
    ).trim();
    if (repairId) return `repair:${repairId}`;
    return `notif:${notificationId}`;
  }

  private resolvePanelBadgeSection(
    userId: string,
    type: NotificationType,
    meta: Record<string, unknown>,
    orderMetaById: Map<
      string,
      {
        buyerId: string;
        sellerId: string;
        status: OrderStatus;
        type: string;
      }
    >,
  ): PanelBadgeSection | null {
    if (
      type === NotificationType.LISTING_APPROVED ||
      type === NotificationType.LISTING_REJECTED
    ) {
      return 'listing';
    }
    if (type === NotificationType.TICKET_REPLY) return 'ticket';
    if (type === NotificationType.REPAIR_STATUS_CHANGED) return 'repairs';
    if (REQUEST_NOTIFICATION_TYPES.includes(type)) return 'requests';

    if (type === NotificationType.ORDER_STATUS_CHANGED) {
      const orderId = String(meta['orderId'] ?? '').trim();
      if (orderId) {
        const order = orderMetaById.get(orderId);
        if (order && TERMINAL_ORDER_STATUSES_FOR_BADGE.includes(order.status)) {
          return null;
        }
      }

      const roleHint = String(
        meta['role'] ?? meta['audience'] ?? '',
      ).toUpperCase();
      if (roleHint === 'BUYER') return 'buy';
      if (roleHint === 'SELLER') return 'sell';

      if (orderId) {
        const order = orderMetaById.get(orderId);
        if (!order) return null;
        if (order.buyerId === userId) return 'buy';
        if (order.sellerId === userId) return 'sell';
      }
    }

    return null;
  }

  async completeProfile(
    userId: string,
    dto: CompleteProfileDto,
    nationalCardImageFilename?: string,
    ipAddress?: string | null,
  ): Promise<MyProfile> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        nationalCardImage: true,
        referredById: true,
        phone: true,
        status: true,
        isVerified: true,
      },
    });
    if (!currentUser) throw new NotFoundException('کاربر یافت نشد');

    const duplicate = await this.prisma.user.findFirst({
      where: { nationalCode: dto.nationalCode, NOT: { id: userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('این کد ملی قبلاً در سیستم ثبت شده است.');
    }

    const rawShaba = (dto.shabaNumber ?? '').replace(/^IR/i, '').trim();
    let shabaNumber: string | null = null;
    if (rawShaba) {
      if (rawShaba.length !== 24) {
        throw new BadRequestException('شماره شبا باید ۲۴ رقم باشد.');
      }
      shabaNumber = rawShaba;
    }

    const alreadyApproved =
      currentUser.status === UserStatus.APPROVED && currentUser.isVerified;

    const restriction = await this.inquiryRestrictions.getSnapshot(userId);
    const useZohalIdentity =
      !alreadyApproved &&
      !restriction.inquiryBlocked &&
      !restriction.manualEntryOnly &&
      (await this.zohalSettings.isIdentityActive());

    let firstName = String(dto.firstName ?? '').trim();
    let lastName = String(dto.lastName ?? '').trim();
    let fatherName: string | null = null;
    let identityInquiry: Prisma.InputJsonValue | undefined;
    let autoVerified = false;

    if (useZohalIdentity) {
      if (!dto.birthDate) {
        throw new BadRequestException(
          'تاریخ تولد برای استعلام هویت الزامی است.',
        );
      }
      if (!currentUser.phone?.trim()) {
        throw new BadRequestException('شماره موبایل حساب کاربری یافت نشد.');
      }
      try {
        const shahkar = await this.zohal.assertShahkarMatched(
          currentUser.phone,
          dto.nationalCode,
          userId,
          ipAddress ?? undefined,
        );
        const identity = await this.zohal.inquireNationalIdentity(
          dto.nationalCode,
          dto.birthDate,
          userId,
          ipAddress ?? undefined,
        );
        firstName = identity.firstName;
        lastName = identity.lastName;
        fatherName = identity.fatherName;
        identityInquiry = {
          shahkar: { matched: shahkar.matched },
          identity: {
            alive: identity.raw.alive ?? identity.alive,
            father_name: identity.fatherName,
            first_name: identity.firstName,
            is_dead: identity.raw.is_dead ?? identity.isDead,
            last_name: identity.lastName,
            matched: identity.raw.matched ?? true,
            national_code: identity.nationalCode,
          },
        };
        autoVerified = true;
      } catch (err) {
        if (isZohalServiceFailure(err)) {
          const { circuitOpen } =
            await this.zohalSettings.recordIdentityFailure();
          if (circuitOpen) {
            throw new BadRequestException({
              message:
                'استعلام خودکار هویت موقتاً در دسترس نیست. لطفاً اطلاعات را به‌صورت دستی وارد کنید.',
              code: 'KYC_MANUAL_REQUIRED',
            });
          }
        }
        throw err;
      }
    } else if (!alreadyApproved) {
      if (firstName.length < 2) {
        throw new BadRequestException('نام الزامی است.');
      }
      if (lastName.length < 2) {
        throw new BadRequestException('نام خانوادگی الزامی است.');
      }
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const referredById = await this.referralService.resolveReferrerId(
          tx,
          userId,
          dto.referralCode,
          currentUser.referredById,
        );

        return tx.user.update({
          where: { id: userId },
          data: {
            firstName,
            lastName,
            ...(fatherName != null ? { fatherName } : {}),
            ...(identityInquiry != null ? { identityInquiry } : {}),
            displayName: this.normalizeDisplayName(dto.displayName),
            nationalCode: dto.nationalCode,
            shabaNumber,
            ...(dto.birthDate
              ? { birthDate: new Date(dto.birthDate) }
              : {}),
            ...(nationalCardImageFilename
              ? { nationalCardImage: nationalCardImageFilename }
              : {}),
            ...(referredById ? { referredById } : {}),
            status: UserStatus.PENDING,
          },
          select: MY_PROFILE_SELECT,
        });
      });
      void this.notifications
        .notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_KYC_SUBMISSION,
          title: autoVerified
            ? 'احراز هویت خودکار'
            : 'درخواست احراز هویت جدید',
          message: autoVerified
            ? `${firstName} ${lastName} با استعلام شاهکار و ثبت احوال تایید شد.`
            : `${firstName} ${lastName} مدارک احراز هویت را برای بررسی ارسال کرد.`,
          meta: { userId, autoVerified },
        })
        .catch(() => undefined);
      if (autoVerified) {
        await this.adminUsers.approve(userId, { source: 'zohal' });
        return this.getMe(userId);
      }
      const shopSlug = await ensureUserShopSlug(this.prisma, updated);
      return this.toProfile({ ...updated, shopSlug });
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const targetFields = Array.isArray(err.meta?.target)
          ? err.meta?.target.map((x) => String(x))
          : [];
        if (targetFields.includes('nationalCode')) {
          throw new BadRequestException('این کدملی تو سامانه وجود دارد.');
        }
      }
      throw err;
    }
  }

  async updateSettings(
    userId: string,
    dto: UpdateSettingsDto,
    nationalCardImageFilename?: string,
  ): Promise<MyProfile> {
    const data: Prisma.UserUpdateInput = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      displayName:
        dto.displayName !== undefined
          ? this.normalizeDisplayName(dto.displayName)
          : undefined,
      email: dto.email,
      bio: dto.bio,
      avatar: dto.avatar,
      notifyEmail: this.toBool(dto.notifyEmail),
      notifySms: this.toBool(dto.notifySms),
      notifyPush: this.toBool(dto.notifyPush),
    };

    if (dto.birthDate !== undefined) {
      data.birthDate = dto.birthDate ? new Date(dto.birthDate) : null;
    }

    if (nationalCardImageFilename) {
      data.nationalCardImage = nationalCardImageFilename;
      data.status = UserStatus.PENDING;
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data,
        select: MY_PROFILE_SELECT,
      });
      if (nationalCardImageFilename) {
        const userName =
          `${updated.firstName ?? ''} ${updated.lastName ?? ''}`.trim() ||
          updated.phone;
        void this.notifications
          .notifyAdminPersonnel({
            type: NotificationType.ADMIN_ALERT_KYC_SUBMISSION,
            title: 'درخواست احراز هویت جدید',
            message: `${userName} مدارک احراز هویت را برای بررسی ارسال کرد.`,
            meta: { userId },
          })
          .catch(() => undefined);
      }
      const shopSlug = await ensureUserShopSlug(this.prisma, updated);
      return this.toProfile({ ...updated, shopSlug });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new BadRequestException('این ایمیل قبلاً ثبت شده است.');
      }
      throw err;
    }
  }

  private toBool(value: boolean | string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  }

  private normalizeDisplayName(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed ? trimmed : null;
  }

  async acceptTerms(
    userId: string,
    ip?: string,
    userAgent?: string,
    kind: 'TERMS' | 'SELLER' = 'TERMS',
  ): Promise<MyProfile> {
    const now = new Date();
    const versionRow = await this.prisma.systemSetting.findUnique({
      where: { key: 'TERMS_VERSION' },
      select: { value: true },
    });
    const version = versionRow?.value?.trim() || '1';
    const data =
      kind === 'SELLER'
        ? {
            sellerTermsAcceptedAt: now,
            sellerTermsAcceptedVersion: version,
          }
        : {
            termsAcceptedAt: now,
            termsAcceptedVersion: version,
          };
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data,
      select: MY_PROFILE_SELECT,
    });
    appendJsonLog('terms-consent.log', {
      at: now.toISOString(),
      userId,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      event: kind === 'SELLER' ? 'SELLER_TERMS_ACCEPTED' : 'TERMS_ACCEPTED',
      version,
    });
    return this.toProfile(updated);
  }
}
