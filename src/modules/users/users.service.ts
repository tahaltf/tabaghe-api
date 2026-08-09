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
  NotificationType,
  OrderStatus,
  Prisma,
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
import {
  isFinancialVerified,
  isIdentityVerified,
} from '../../common/kyc/kyc-profile.util';

const MY_PROFILE_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  nationalCode: true,
  shabaNumber: true,
  nationalCardImage: true,
  avatar: true,
  bio: true,
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
} satisfies Prisma.UserSelect;

export type MyProfile = Prisma.UserGetPayload<{
  select: typeof MY_PROFILE_SELECT;
}> & { panelAccess: UserPanelAccessMap };

export interface DashboardStats {
  activeAuctions: number;
  highestBidderCount: number;
  wonBids: number;
  exchangeOffersReceived: number;
  balanceBlocked: Prisma.Decimal | number;
  balanceAvailable: Prisma.Decimal | number;
  activeListings: number;
  remainingQuota: number;
}

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
  ) {}

  async getMe(userId: string): Promise<MyProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: MY_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return this.toProfile(user);
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
    const [settings, restrictedPanelAccess] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where: {
          key: {
            in: [
              'KYC_REQUIRE_IDENTITY_FOR_ORDERS',
              'KYC_REQUIRE_FINANCIAL_FOR_WALLET',
              'KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW',
            ],
          },
        },
        select: { key: true, value: true },
      }),
      Promise.resolve(baseAccess),
    ]);
    const settingsMap: Record<string, string> = {};
    for (const item of settings) settingsMap[item.key] = item.value;
    const identityOk = isIdentityVerified(user);
    const financialOk = isFinancialVerified(user);
    const requireIdentityForOrders =
      String(settingsMap.KYC_REQUIRE_IDENTITY_FOR_ORDERS ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWallet =
      String(settingsMap.KYC_REQUIRE_FINANCIAL_FOR_WALLET ?? 'true').toLowerCase() !==
      'false';
    const requireFinancialForWithdraw =
      String(settingsMap.KYC_REQUIRE_FINANCIAL_FOR_WITHDRAW ?? 'true').toLowerCase() !==
      'false';
    if (requireIdentityForOrders && !identityOk) {
      restrictedPanelAccess['dashboard.orders'] = false;
    }
    if (requireFinancialForWallet && !financialOk) {
      restrictedPanelAccess['dashboard.wallet'] = false;
    }
    if (requireFinancialForWithdraw && !financialOk) {
      restrictedPanelAccess['dashboard.wallet.withdraw'] = false;
    }
    return {
      ...profile,
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
    const [
      activeBids,
      finishedBids,
      exchangeOffersReceived,
      activeListings,
      wallet,
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
  ): Promise<MyProfile> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { nationalCardImage: true, referredById: true },
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
            firstName: dto.firstName,
            lastName: dto.lastName,
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
          title: 'درخواست احراز هویت جدید',
          message: `${dto.firstName} ${dto.lastName} مدارک احراز هویت را برای بررسی ارسال کرد.`,
          meta: { userId },
        })
        .catch(() => undefined);
      return this.toProfile(updated);
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
      return this.toProfile(updated);
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
  ): Promise<MyProfile> {
    const now = new Date();
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { termsAcceptedAt: now },
      select: MY_PROFILE_SELECT,
    });
    appendJsonLog('terms-consent.log', {
      at: now.toISOString(),
      userId,
      ip: ip ?? null,
      userAgent: userAgent ?? null,
      event: 'TERMS_ACCEPTED',
    });
    return this.toProfile(updated);
  }
}
