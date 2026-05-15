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
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { appendJsonLog } from '../../common/logging/app-log.util';

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
  NotificationType.AUCTION_PENALIZED,
  NotificationType.BUY_NOW,
];

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
   * شمارش اعلان‌های خوانده‌نشده برای badge منوی پنل کاربر (بدون هم‌پوشانی بین بخش‌ها).
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

    const orderIds = [
      ...new Set(
        unread
          .filter((n) => n.type === NotificationType.ORDER_STATUS_CHANGED)
          .map((n) => {
            const meta = (n.meta ?? {}) as Record<string, unknown>;
            return String(meta['orderId'] ?? '').trim();
          })
          .filter(Boolean),
      ),
    ];

    const orderRoleById = new Map<string, 'buy' | 'sell'>();
    if (orderIds.length > 0) {
      const orders = await this.prisma.order.findMany({
        where: { id: { in: orderIds } },
        select: { id: true, buyerId: true, sellerId: true },
      });
      for (const o of orders) {
        if (o.buyerId === userId) orderRoleById.set(o.id, 'buy');
        else if (o.sellerId === userId) orderRoleById.set(o.id, 'sell');
      }
    }

    const badges: PanelBadges = {
      listing: 0,
      buy: 0,
      sell: 0,
      requests: 0,
      ticket: 0,
      repairs: 0,
    };

    for (const n of unread) {
      const section = this.resolvePanelBadgeSection(
        n.type,
        (n.meta ?? {}) as Record<string, unknown>,
        orderRoleById,
      );
      if (!section) continue;

      const seenAt = sectionSeenAt[section];
      if (seenAt) {
        const createdAt = new Date(n.createdAt).getTime();
        if (Number.isFinite(createdAt) && createdAt <= seenAt) continue;
      }

      badges[section] += 1;
    }

    return badges;
  }

  private resolvePanelBadgeSection(
    type: NotificationType,
    meta: Record<string, unknown>,
    orderRoleById: Map<string, 'buy' | 'sell'>,
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
      const role = String(meta['role'] ?? '').toUpperCase();
      if (role === 'BUYER') return 'buy';
      if (role === 'SELLER') return 'sell';
      const orderId = String(meta['orderId'] ?? '').trim();
      if (orderId) return orderRoleById.get(orderId) ?? null;
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
      return await this.prisma.user.update({
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
      return await this.prisma.user.update({
        where: { id: userId },
        data,
        select: MY_PROFILE_SELECT,
      });
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
