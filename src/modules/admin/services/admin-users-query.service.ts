import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingType,
  Prisma,
  QuotaAction,
  QuotaReason,
  UserRole,
  UserStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UserRatingHistoryService } from '../../users/user-rating-history.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminUserListQueryDto } from '../dto/admin-query.dto';
import { AuthenticatedUser } from '../../../shared/contracts/auth';

const USER_LIST_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  rating: true,
  trustScore: true,
  status: true,
  role: true,
  isActive: true,
  isVerified: true,
  createdAt: true,
  lastLoginAt: true,
  avatar: true,
} satisfies Prisma.UserSelect;

const USER_DETAIL_INCLUDE = {
  wallet: {
    select: {
      balanceAvailable: true,
      balanceBlocked: true,
      balanceCredit: true,
    },
  },
  _count: {
    select: {
      listings: true,
      buyerOrders: true,
      sellerOrders: true,
      bids: true,
      exchangeOffers: true,
    },
  },
} satisfies Prisma.UserInclude;

export type AdminUserListItemRaw = Prisma.UserGetPayload<{
  select: typeof USER_LIST_SELECT;
}>;
export type AdminUserDetail = Prisma.UserGetPayload<{
  include: typeof USER_DETAIL_INCLUDE;
}>;

export interface AdminUserPlanInfo {
  id: string;
  planId: string;
  title: string;
  status: string;
  isBuiltinFree: boolean;
  purchasedAt: Date;
  expiresAt: Date | null;
  daysRemaining: number | null;
  isActive: boolean;
}

export interface AdminUserListItem extends AdminUserListItemRaw {
  activePlan: AdminUserPlanInfo | null;
}
export interface AdminUserActivityItem {
  id: string;
  kind:
    | 'LISTING'
    | 'ORDER_BUY'
    | 'ORDER_SELL'
    | 'TICKET'
    | 'EXCHANGE_OFFER'
    | 'AUCTION_BID';
  title: string;
  subtitle: string;
  createdAt: Date;
  meta?: Record<string, unknown>;
}
const ADMIN_DEFAULT_PASSWORD = '@Ab123456789@';

@Injectable()
export class AdminUsersQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRatingHistory: UserRatingHistoryService,
  ) {}

  async list(
    actor: AuthenticatedUser,
    query: AdminUserListQueryDto,
  ): Promise<PaginatedResult<AdminUserListItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.role) where.role = query.role;
    if (actor.role === UserRole.ADMIN) {
      where.role = UserRole.USER;
    }
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { phone: { contains: s } },
        { firstName: { contains: s, mode: 'insensitive' } },
        { lastName: { contains: s, mode: 'insensitive' } },
        { email: { contains: s, mode: 'insensitive' } },
        { nationalCode: { contains: s } },
      ];
    }

    const orderBy: Prisma.UserOrderByWithRelationInput = this.buildOrderBy(
      query.sortBy,
      query.sortDir,
    );

    const [rawItems, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    const userIds = rawItems.map((u) => u.id);
    const planByUser = await this.loadActivePlansForUsers(userIds);
    const items: AdminUserListItem[] = rawItems.map((u) => ({
      ...u,
      activePlan: planByUser.get(u.id) ?? null,
    }));

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * نزدیک‌ترین خرید پلنِ فعال هر کاربر را برمی‌گرداند.
   * این متد برای ستون «پلن فعال» در جدول کاربران ادمین استفاده می‌شود.
   */
  private async loadActivePlansForUsers(
    userIds: string[],
  ): Promise<Map<string, AdminUserPlanInfo>> {
    const result = new Map<string, AdminUserPlanInfo>();
    if (!userIds.length) return result;
    const now = new Date();

    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: {
        userId: { in: userIds },
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { plan: true },
      orderBy: { expiresAt: 'asc' },
    });

    for (const p of purchases) {
      if (result.has(p.userId)) continue; // اولین پلن فعال (با نزدیک‌ترین انقضا) را نگه می‌داریم
      const expiresAt = p.expiresAt ?? null;
      const daysRemaining = expiresAt
        ? Math.max(
            0,
            Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000),
          )
        : null;
      result.set(p.userId, {
        id: p.id,
        planId: p.planId,
        title: p.plan?.title ?? 'پلن نامشخص',
        status: p.status,
        isBuiltinFree: false,
        purchasedAt: p.createdAt,
        expiresAt,
        daysRemaining,
        isActive: true,
      });
    }
    return result;
  }

  /**
   * جزئیات کامل پلن‌های یک کاربر (برای پنل «تغییر پلن کاربر» در صفحه ادمین).
   */
  async getUserPlanInfo(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{
    activePurchases: Array<
      AdminUserPlanInfo & {
        plan: { id: string; title: string; price: string | number };
      }
    >;
    history: Array<{
      id: string;
      planTitle: string;
      status: string;
      purchasedAt: Date;
      expiresAt: Date | null;
    }>;
    freeDirect: { limit: number; remaining: number };
    remainingByType: Record<ListingType, number>;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const now = new Date();
    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: { userId },
      include: { plan: { include: { rules: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const activePurchases = purchases
      .filter(
        (p) =>
          p.status === 'ACTIVE' &&
          (p.expiresAt === null || p.expiresAt.getTime() > now.getTime()),
      )
      .map((p) => {
        const expiresAt = p.expiresAt ?? null;
        const daysRemaining = expiresAt
          ? Math.max(
              0,
              Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000),
            )
          : null;
        return {
          id: p.id,
          planId: p.planId,
          title: p.plan?.title ?? 'پلن نامشخص',
          status: p.status,
          isBuiltinFree: false,
          purchasedAt: p.createdAt,
          expiresAt,
          daysRemaining,
          isActive: true,
          plan: {
            id: p.plan?.id ?? p.planId,
            title: p.plan?.title ?? 'پلن نامشخص',
            price: p.plan?.price?.toString() ?? '0',
          },
        };
      });

    const history = purchases.map((p) => ({
      id: p.id,
      planTitle: p.plan?.title ?? 'پلن نامشخص',
      status: p.status,
      purchasedAt: p.createdAt,
      expiresAt: p.expiresAt ?? null,
    }));

    // Remaining quota by type
    const remainingByType: Record<ListingType, number> = {
      DIRECT: 0,
      AUCTION: 0,
      EXCHANGE: 0,
    };

    const activeIds = activePurchases.map((p) => p.id);
    if (activeIds.length) {
      const commits = await this.prisma.quotaLedger.groupBy({
        by: ['planPurchaseId', 'listingType'],
        where: {
          planPurchaseId: { in: activeIds },
          action: QuotaAction.COMMIT,
        },
        _count: { _all: true },
      });
      const map = new Map<string, number>();
      for (const c of commits) {
        if (c.planPurchaseId) {
          map.set(`${c.planPurchaseId}:${c.listingType}`, c._count._all);
        }
      }
      for (const p of purchases) {
        if (!activeIds.includes(p.id) || !p.plan) continue;
        for (const r of p.plan.rules ?? []) {
          const used = map.get(`${p.id}:${r.type}`) ?? 0;
          remainingByType[r.type] =
            (remainingByType[r.type] ?? 0) + Math.max(0, r.count - used);
        }
      }
    }

    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: 'FREE_DIRECT_QUOTA' },
    });
    const freeLimit = setting
      ? Math.max(0, Math.floor(Number(setting.value) || 0))
      : 2;
    const [freeCommits, freeReleases] = await Promise.all([
      this.prisma.quotaLedger.count({
        where: {
          userId,
          listingType: ListingType.DIRECT,
          reason: QuotaReason.FREE_DIRECT,
          action: QuotaAction.COMMIT,
        },
      }),
      this.prisma.quotaLedger.count({
        where: {
          userId,
          listingType: ListingType.DIRECT,
          reason: QuotaReason.FREE_DIRECT,
          action: QuotaAction.RELEASE,
        },
      }),
    ]);
    const freeRemaining = Math.max(0, freeLimit - (freeCommits - freeReleases));

    return {
      activePurchases,
      history,
      freeDirect: { limit: freeLimit, remaining: freeRemaining },
      remainingByType,
    };
  }

  /**
   * انتساب پلن جدید به کاربر توسط ادمین (بدون کسر از کیف پول).
   * - پلن فعلی فعال (در صورت وجود) لغو می‌شود.
   * - یک خرید جدید با تاریخ امروز ایجاد می‌شود.
   */
  async assignPlanToUser(
    actor: AuthenticatedUser,
    userId: string,
    planId: string,
  ): Promise<{ id: string; planId: string; expiresAt: Date | null }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { rules: true },
    });
    if (!plan || !plan.isActive) {
      throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
    }

    const now = new Date();
    const durationDays = Math.max(1, plan.durationDays ?? 365);
    const expiresAt = new Date(now.getTime());
    expiresAt.setUTCDate(expiresAt.getUTCDate() + durationDays);

    return this.prisma.$transaction(async (tx) => {
      await tx.userPlanPurchase.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      const purchase = await tx.userPlanPurchase.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      // RELEASE entries to mark allocated quota (consistent with PlansService.buyPlan)
      for (const rule of plan.rules) {
        const entries = Array.from({ length: rule.count }).map(() => ({
          userId,
          planPurchaseId: purchase.id,
          listingType: rule.type,
          action: QuotaAction.RELEASE,
          reason: QuotaReason.PLAN,
          note: `انتساب پلن «${plan.title}» توسط ادمین`,
        }));
        if (entries.length > 0) {
          await tx.quotaLedger.createMany({ data: entries });
        }
      }

      return {
        id: purchase.id,
        planId: purchase.planId,
        expiresAt: purchase.expiresAt,
      };
    });
  }

  /** لغو پلن فعال کاربر توسط ادمین (انقضای فوری). */
  async cancelActiveUserPlan(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ cancelled: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const result = await this.prisma.userPlanPurchase.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });
    return { cancelled: result.count };
  }

  async detail(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_DETAIL_INCLUDE,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);
    return user;
  }

  async toggleRole(
    actor: AuthenticatedUser,
    userId: string,
  ): Promise<{ id: string; role: UserRole }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, passwordHash: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);
    const nextRole =
      user.role === UserRole.USER ? UserRole.ADMIN : UserRole.USER;
    const shouldSetDefaultAdminPassword =
      nextRole === UserRole.ADMIN && !user.passwordHash;

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        role: nextRole,
        ...(shouldSetDefaultAdminPassword
          ? { passwordHash: await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10) }
          : {}),
      },
      select: { id: true, role: true },
    });
  }

  async setUserPassword(
    actor: AuthenticatedUser,
    userId: string,
    password: string,
  ): Promise<{ id: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const hash = await bcrypt.hash(password, 10);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: hash },
      select: { id: true },
    });
    return updated;
  }

  async setUserActivation(
    actor: AuthenticatedUser,
    userId: string,
    isActive: boolean,
  ): Promise<{ id: string; isActive: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    if (actor.role !== UserRole.GODADMIN) {
      throw new ForbiddenException(
        'فقط گاد ادمین می‌تواند وضعیت حساب را تغییر دهد',
      );
    }
    if (user.role === UserRole.USER) {
      throw new ForbiddenException('این عملیات فقط برای حساب‌های ادمین است');
    }
    if (actor.id === userId && !isActive) {
      throw new ForbiddenException('امکان غیرفعال‌کردن حساب خودتان وجود ندارد');
    }
    return this.prisma.user.update({
      where: { id: userId },
      data: { isActive },
      select: { id: true, isActive: true },
    });
  }

  async setUserRating(
    actor: AuthenticatedUser,
    userId: string,
    rating: number,
  ): Promise<{ id: string; rating: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { rating: true },
    });
    if (!current) throw new NotFoundException('کاربر یافت نشد');

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { rating },
      select: { id: true, rating: true },
    });

    await this.userRatingHistory.record(this.prisma, {
      userId,
      previous: Number(current.rating ?? 5),
      next: rating,
      reason: 'تغییر دستی امتیاز توسط ادمین',
      source: 'admin_manual',
      actorId: actor.id,
    });

    return updated;
  }

  async ratingHistory(
    actor: AuthenticatedUser,
    userId: string,
    limit = 50,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);
    return this.userRatingHistory.listForUser(userId, limit);
  }

  async createUser(
    actor: AuthenticatedUser,
    input: {
      phone: string;
      password?: string;
      firstName?: string;
      lastName?: string;
      role?: UserRole;
      isActive?: boolean;
    },
  ): Promise<{ id: string; phone: string; role: UserRole; isActive: boolean }> {
    const phone = input.phone.trim();
    const requestedRole = input.role ?? UserRole.USER;
    const role =
      actor.role === UserRole.GODADMIN ? requestedRole : UserRole.USER;
    if (actor.role !== UserRole.GODADMIN && requestedRole !== UserRole.USER) {
      throw new ForbiddenException('ادمین فقط می‌تواند کاربر عادی ایجاد کند');
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException(
        'کاربری با این شماره موبایل قبلاً ثبت شده است',
      );
    }

    const rawPassword = input.password?.trim() || ADMIN_DEFAULT_PASSWORD;
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const created = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          firstName: input.firstName?.trim() || null,
          lastName: input.lastName?.trim() || null,
          role,
          isActive: input.isActive ?? true,
          status: UserStatus.INCOMPLETE,
          passwordHash,
        },
        select: { id: true, phone: true, role: true, isActive: true },
      });
      await tx.wallet.create({ data: { userId: user.id } });
      return user;
    });
    return created;
  }

  async activities(
    actor: AuthenticatedUser,
    userId: string,
    limit = 50,
  ): Promise<AdminUserActivityItem[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        firstName: true,
        lastName: true,
        phone: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const take = Math.max(
      1,
      Math.min(Number.isFinite(limit) ? limit : 50, 100),
    );
    const [listings, buyerOrders, sellerOrders, tickets, offers, bids] =
      await Promise.all([
        this.prisma.listing.findMany({
          where: { authorId: userId },
          select: { id: true, title: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.order.findMany({
          where: { buyerId: userId },
          select: {
            id: true,
            status: true,
            type: true,
            listing: { select: { title: true } },
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.order.findMany({
          where: { sellerId: userId },
          select: {
            id: true,
            status: true,
            type: true,
            listing: { select: { title: true } },
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.ticket.findMany({
          where: { userId },
          select: { id: true, subject: true, status: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.exchangeOffer.findMany({
          where: { offererId: userId },
          select: {
            id: true,
            status: true,
            title: true,
            listing: { select: { title: true } },
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),
        this.prisma.auctionBid.findMany({
          where: { bidderId: userId },
          select: {
            id: true,
            amount: true,
            status: true,
            auction: { select: { listing: { select: { title: true } } } },
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take,
        }),
      ]);

    const items: AdminUserActivityItem[] = [
      ...listings.map((x) => ({
        id: `listing:${x.id}`,
        kind: 'LISTING' as const,
        title: 'ثبت/ویرایش آگهی',
        subtitle: `${x.title} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { listingId: x.id },
      })),
      ...buyerOrders.map((x) => ({
        id: `order-buy:${x.id}`,
        kind: 'ORDER_BUY' as const,
        title: 'فعالیت خرید',
        subtitle: `${x.listing?.title ?? 'سفارش'} — نوع: ${x.type} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { orderId: x.id },
      })),
      ...sellerOrders.map((x) => ({
        id: `order-sell:${x.id}`,
        kind: 'ORDER_SELL' as const,
        title: 'فعالیت فروش',
        subtitle: `${x.listing?.title ?? 'سفارش'} — نوع: ${x.type} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { orderId: x.id },
      })),
      ...tickets.map((x) => ({
        id: `ticket:${x.id}`,
        kind: 'TICKET' as const,
        title: 'تیکت پشتیبانی',
        subtitle: `${x.subject} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { ticketId: x.id },
      })),
      ...offers.map((x) => ({
        id: `exchange-offer:${x.id}`,
        kind: 'EXCHANGE_OFFER' as const,
        title: 'پیشنهاد معاوضه',
        subtitle: `${x.title} — روی آگهی: ${x.listing.title} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { exchangeOfferId: x.id },
      })),
      ...bids.map((x) => ({
        id: `auction-bid:${x.id}`,
        kind: 'AUCTION_BID' as const,
        title: 'پیشنهاد مزایده',
        subtitle: `${x.auction.listing.title} — مبلغ: ${x.amount.toString()} — وضعیت: ${x.status}`,
        createdAt: x.createdAt,
        meta: { bidId: x.id },
      })),
    ];

    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  }

  private assertCanManageTarget(
    actor: AuthenticatedUser,
    targetRole: UserRole,
  ): void {
    if (actor.role === UserRole.GODADMIN) return;
    if (actor.role === UserRole.ADMIN && targetRole === UserRole.USER) return;
    throw new ForbiddenException('شما اجازه مدیریت این حساب را ندارید');
  }

  private buildOrderBy(
    sortBy?: string,
    sortDir?: 'asc' | 'desc',
  ): Prisma.UserOrderByWithRelationInput {
    const dir: 'asc' | 'desc' = sortDir === 'asc' ? 'asc' : 'desc';
    const allowed: Record<string, Prisma.UserOrderByWithRelationInput> = {
      createdAt: { createdAt: dir },
      updatedAt: { updatedAt: dir },
      lastLoginAt: { lastLoginAt: dir },
      firstName: { firstName: dir },
      phone: { phone: dir },
      rating: { rating: dir },
      trustScore: { trustScore: dir },
    };
    return allowed[sortBy ?? ''] ?? { createdAt: dir };
  }
}
