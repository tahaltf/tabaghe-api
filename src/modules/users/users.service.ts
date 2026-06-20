import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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

const MY_PROFILE_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
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
} satisfies Prisma.UserSelect;

export type MyProfile = Prisma.UserGetPayload<{
  select: typeof MY_PROFILE_SELECT;
}>;

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
  ) {}

  async getMe(userId: string): Promise<MyProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: MY_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return user;
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
      select: { nationalCardImage: true },
    });
    if (!currentUser) throw new NotFoundException('کاربر یافت نشد');

    const duplicate = await this.prisma.user.findFirst({
      where: { nationalCode: dto.nationalCode, NOT: { id: userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('این کد ملی قبلاً در سیستم ثبت شده است.');
    }

    const cleanShaba = dto.shabaNumber.replace(/^IR/i, '').trim();
    if (cleanShaba.length !== 24) {
      throw new BadRequestException('شماره شبا باید ۲۴ رقم باشد.');
    }

    if (!nationalCardImageFilename && !currentUser.nationalCardImage) {
      throw new BadRequestException('تصویر کارت ملی الزامی است');
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: userId },
        data: {
          firstName: dto.firstName,
          lastName: dto.lastName,
          nationalCode: dto.nationalCode,
          shabaNumber: cleanShaba,
          ...(nationalCardImageFilename
            ? { nationalCardImage: nationalCardImageFilename }
            : {}),
          status: UserStatus.PENDING,
        },
        select: MY_PROFILE_SELECT,
      });
      void this.notifications
        .notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_KYC_SUBMISSION,
          title: 'درخواست احراز هویت جدید',
          message: `${dto.firstName} ${dto.lastName} مدارک احراز هویت را برای بررسی ارسال کرد.`,
          meta: { userId },
        })
        .catch(() => undefined);
      return updated;
    } catch (err) {
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
      email: dto.email,
      bio: dto.bio,
      avatar: dto.avatar,
      notifyEmail: this.toBool(dto.notifyEmail),
      notifySms: this.toBool(dto.notifySms),
      notifyPush: this.toBool(dto.notifyPush),
    };

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
      return updated;
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
    return updated;
  }
}
