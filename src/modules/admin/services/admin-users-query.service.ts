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
import { ratingToTrustScore } from '../../../common/user-reputation.util';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { UserRatingHistoryService } from '../../users/user-rating-history.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminUserListQueryDto } from '../dto/admin-query.dto';
import { AdminUpdateUserProfileDto } from '../dto/admin-update-user-profile.dto';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { getListingStatusLabelFa } from '../../../common/listing/listing-status-labels.util';
import { getOrderStatusLabelFa } from '../../../common/order/order-status-labels.util';
import { PlanLifecycleService } from '../../plans/plan-lifecycle.service';
import { generateInviteCode } from '../../../common/referral/invite-code.util';

const LISTING_TYPE_LABELS_FA: Record<string, string> = {
  DIRECT: 'فروش مستقیم',
  AUCTION: 'مزایده',
  EXCHANGE: 'معاوضه',
};

const TICKET_STATUS_LABELS_FA: Record<string, string> = {
  OPEN: 'باز',
  ANSWERED: 'پاسخ‌داده‌شده',
  CLOSED: 'بسته',
};

const EXCHANGE_OFFER_STATUS_LABELS_FA: Record<string, string> = {
  PENDING: 'در انتظار',
  WAITLISTED: 'لیست انتظار',
  ACCEPTED: 'پذیرفته‌شده',
  REJECTED: 'رد شده',
  CANCELLED: 'لغو شده',
};

const AUCTION_BID_STATUS_LABELS_FA: Record<string, string> = {
  ACTIVE: 'فعال',
  OUTBID: 'پیشی گرفته شد',
  WON: 'برنده',
  LOST: 'بازنده',
  CANCELLED: 'لغو شده',
};

function listingTypeLabelFa(type: string): string {
  return LISTING_TYPE_LABELS_FA[type] ?? type;
}

function ticketStatusLabelFa(status: string): string {
  return TICKET_STATUS_LABELS_FA[status] ?? status;
}

function exchangeOfferStatusLabelFa(status: string): string {
  return EXCHANGE_OFFER_STATUS_LABELS_FA[status] ?? status;
}

function auctionBidStatusLabelFa(status: string): string {
  return AUCTION_BID_STATUS_LABELS_FA[status] ?? status;
}

const USER_LIST_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  displayName: true,
  rating: true,
  trustScore: true,
  status: true,
  role: true,
  adminRoleId: true,
  adminRole: {
    select: { id: true, name: true, slug: true },
  },
  isActive: true,
  isVerified: true,
  isApproved: true,
  createdAt: true,
  lastLoginAt: true,
  avatar: true,
  inviteCode: true,
  referredById: true,
  referredBy: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      inviteCode: true,
    },
  },
  _count: {
    select: {
      referrals: true,
    },
  },
} satisfies Prisma.UserSelect;

const USER_DETAIL_INCLUDE = {
  wallet: {
    select: {
      balanceAvailable: true,
      balanceBlocked: true,
      balanceCredit: true,
    },
  },
  adminRole: {
    select: { id: true, name: true, slug: true },
  },
  referredBy: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      inviteCode: true,
    },
  },
  referrals: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
      createdAt: true,
      status: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 100,
  },
  _count: {
    select: {
      listings: true,
      buyerOrders: true,
      sellerOrders: true,
      bids: true,
      exchangeOffers: true,
      referrals: true,
    },
  },
} satisfies Prisma.UserInclude;

export type AdminUserListItemRaw = Prisma.UserGetPayload<{
  select: typeof USER_LIST_SELECT;
}>;
export type AdminUserDetail = Prisma.UserGetPayload<{
  include: typeof USER_DETAIL_INCLUDE;
}>;

export type { AdminUserPlanInfo } from './admin-user-plan-lookup.service';
import {
  AdminUserPlanLookupService,
  AdminUserPlanInfo,
} from './admin-user-plan-lookup.service';

export interface AdminUserListItem extends AdminUserListItemRaw {
  activePlan: AdminUserPlanInfo | null;
}
export interface AdminUserActivityItem {
  id: string;
  kind:
    | 'LISTING'
    | 'LISTING_VIEW'
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

/** @deprecated Dev-only fallback; production admin creation requires explicit password. */
function resolveNewAdminPassword(input?: string | null): string {
  const trimmed = input?.trim();
  if (trimmed) return trimmed;
  if (process.env.NODE_ENV !== 'production') return ADMIN_DEFAULT_PASSWORD;
  throw new BadRequestException('رمز عبور برای ایجاد ادمین الزامی است.');
}

@Injectable()
export class AdminUsersQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userRatingHistory: UserRatingHistoryService,
    private readonly userPlanLookup: AdminUserPlanLookupService,
    private readonly planLifecycle: PlanLifecycleService,
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
    const planByUser = await this.userPlanLookup.loadActivePlansForUsers(userIds);
    const items: AdminUserListItem[] = rawItems.map((u) => ({
      ...u,
      activePlan: planByUser.get(u.id) ?? null,
    }));

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
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
          badgeLabel: p.plan?.badgeLabel?.trim() || null,
          badgeColor: p.plan?.badgeColor?.trim() || null,
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

    const granted = await this.planLifecycle.grantReplacingActive(
      userId,
      planId,
      'انتساب پلن توسط ادمین',
    );

    await this.planLifecycle.notifyPlanChange({
      userId,
      kind: 'ADMIN_ASSIGN',
      planTitle: granted.planTitle,
      previousPlanTitle: granted.previousPlanTitle,
      expiresAt: granted.expiresAt,
    });

    return {
      id: granted.id,
      planId: granted.planId,
      expiresAt: granted.expiresAt,
    };
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

    const previous = await this.prisma.userPlanPurchase.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: { plan: { select: { title: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const result = await this.prisma.userPlanPurchase.updateMany({
      where: { userId, status: 'ACTIVE' },
      data: { status: 'CANCELLED' },
    });

    if (result.count > 0) {
      await this.planLifecycle.notifyPlanChange({
        userId,
        kind: 'ADMIN_CANCEL',
        planTitle: previous?.plan?.title ?? 'پلن',
        previousPlanTitle: previous?.plan?.title ?? null,
      });
    }

    return { cancelled: result.count };
  }

  async updateUserProfile(
    actor: AuthenticatedUser,
    userId: string,
    dto: AdminUpdateUserProfileDto,
    nationalCardImageFilename?: string,
  ): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const data: Prisma.UserUpdateInput = {};

    if (dto.firstName !== undefined) {
      data.firstName = dto.firstName.trim() || null;
    }
    if (dto.lastName !== undefined) {
      data.lastName = dto.lastName.trim() || null;
    }
    if (dto.displayName !== undefined) {
      const displayName = dto.displayName.trim();
      data.displayName = displayName || null;
    }
    if (dto.bio !== undefined) {
      data.bio = dto.bio.trim() || null;
    }
    if (dto.email !== undefined) {
      data.email = dto.email.trim() || null;
    }
    if (dto.nationalCode !== undefined) {
      const code = dto.nationalCode.trim();
      if (!code) {
        data.nationalCode = null;
      } else {
        const duplicate = await this.prisma.user.findFirst({
          where: { nationalCode: code, NOT: { id: userId } },
          select: { id: true },
        });
        if (duplicate) {
          throw new BadRequestException('این کدملی در سامانه ثبت شده است.');
        }
        data.nationalCode = code;
      }
    }
    if (dto.shabaNumber !== undefined) {
      const raw = dto.shabaNumber.trim();
      data.shabaNumber = raw ? raw.replace(/^IR/i, '').trim() : null;
    }
    if (dto.clearAvatar) {
      data.avatar = null;
    } else if (dto.avatar !== undefined) {
      const avatar = dto.avatar.trim();
      data.avatar = avatar || null;
    }
    if (dto.clearNationalCardImage) {
      data.nationalCardImage = null;
    } else if (nationalCardImageFilename) {
      data.nationalCardImage = nationalCardImageFilename;
    }

    if (!Object.keys(data).length) {
      return this.detail(actor, userId);
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data,
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const targetFields = Array.isArray(err.meta?.target)
          ? err.meta?.target.map((x) => String(x))
          : [];
        if (targetFields.includes('email')) {
          throw new BadRequestException('این ایمیل قبلاً ثبت شده است.');
        }
        if (targetFields.includes('nationalCode')) {
          throw new BadRequestException('این کدملی در سامانه ثبت شده است.');
        }
      }
      throw err;
    }

    return this.detail(actor, userId);
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
  ): Promise<{ id: string; role: UserRole; adminRoleId: string | null }> {
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

    if (shouldSetDefaultAdminPassword) {
      throw new BadRequestException(
        'قبل از ارتقا به ادمین، رمز عبور کاربر را تنظیم کنید.',
      );
    }

    let adminRoleId: string | null = null;
    if (nextRole === UserRole.ADMIN) {
      const fullOps = await this.prisma.adminRole.findUnique({
        where: { slug: 'full-ops' },
        select: { id: true },
      });
      adminRoleId = fullOps?.id ?? null;
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        role: nextRole,
        adminRoleId,
      },
      select: { id: true, role: true, adminRoleId: true },
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

  async setUserApproved(
    actor: AuthenticatedUser,
    userId: string,
    isApproved: boolean,
  ): Promise<{ id: string; isApproved: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    return this.prisma.user.update({
      where: { id: userId },
      data: { isApproved },
      select: { id: true, isApproved: true },
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

    const normalizedRating = Math.min(5, Math.max(0, Number(rating)));

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        rating: normalizedRating,
        trustScore: ratingToTrustScore(normalizedRating),
      },
      select: { id: true, rating: true },
    });

    await this.userRatingHistory.record(this.prisma, {
      userId,
      previous: Number(current.rating ?? 5),
      next: normalizedRating,
      reason: 'تغییر دستی امتیاز توسط ادمین',
      source: 'admin_manual',
      actorId: actor.id,
    });

    return updated;
  }

  async setUserTrustScore(
    actor: AuthenticatedUser,
    userId: string,
    trustScore: number,
  ): Promise<{ id: string; trustScore: number }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const normalized = Math.round(Math.min(100, Math.max(0, trustScore)));
    const rating = normalized / 20;
    const result = await this.setUserRating(actor, userId, rating);
    return { id: result.id, trustScore: ratingToTrustScore(result.rating) };
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
      adminRoleId?: string;
      isActive?: boolean;
    },
  ): Promise<{
    id: string;
    phone: string;
    role: UserRole;
    isActive: boolean;
    adminRoleId: string | null;
  }> {
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

    let adminRoleId: string | null = null;
    if (role === UserRole.ADMIN) {
      if (input.adminRoleId) {
        const customRole = await this.prisma.adminRole.findFirst({
          where: { id: input.adminRoleId, isActive: true },
          select: { id: true },
        });
        if (!customRole) {
          throw new BadRequestException('نقش ادمین انتخاب‌شده معتبر نیست');
        }
        adminRoleId = customRole.id;
      } else {
        const fullOps = await this.prisma.adminRole.findUnique({
          where: { slug: 'full-ops' },
          select: { id: true },
        });
        adminRoleId = fullOps?.id ?? null;
      }
    }

    const rawPassword = resolveNewAdminPassword(input.password);
    const passwordHash = await bcrypt.hash(rawPassword, 10);
    const created = await this.prisma.$transaction(async (tx) => {
      let inviteCode = '';
      for (let attempt = 0; attempt < 12; attempt++) {
        const candidate = generateInviteCode();
        const exists = await tx.user.findUnique({
          where: { inviteCode: candidate },
          select: { id: true },
        });
        if (!exists) {
          inviteCode = candidate;
          break;
        }
      }
      if (!inviteCode) {
        throw new BadRequestException('ساخت کد دعوت ناموفق بود.');
      }
      const user = await tx.user.create({
        data: {
          phone,
          firstName: input.firstName?.trim() || null,
          lastName: input.lastName?.trim() || null,
          role,
          adminRoleId,
          isActive: input.isActive ?? true,
          status: UserStatus.INCOMPLETE,
          passwordHash,
          inviteCode,
        },
        select: {
          id: true,
          phone: true,
          role: true,
          isActive: true,
          adminRoleId: true,
        },
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
    const [listings, buyerOrders, sellerOrders, tickets, offers, bids, listingViews] =
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
        this.prisma.listingView.findMany({
          where: { userId },
          select: {
            id: true,
            viewedAt: true,
            listing: { select: { id: true, title: true } },
          },
          orderBy: { viewedAt: 'desc' },
          take,
        }),
      ]);

    const items: AdminUserActivityItem[] = [
      ...listings.map((x) => ({
        id: `listing:${x.id}`,
        kind: 'LISTING' as const,
        title: 'ثبت/ویرایش آگهی',
        subtitle: `${x.title} — وضعیت: ${getListingStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { listingId: x.id },
      })),
      ...buyerOrders.map((x) => ({
        id: `order-buy:${x.id}`,
        kind: 'ORDER_BUY' as const,
        title: 'فعالیت خرید',
        subtitle: `${x.listing?.title ?? 'سفارش'} — نوع: ${listingTypeLabelFa(x.type)} — وضعیت: ${getOrderStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { orderId: x.id },
      })),
      ...sellerOrders.map((x) => ({
        id: `order-sell:${x.id}`,
        kind: 'ORDER_SELL' as const,
        title: 'فعالیت فروش',
        subtitle: `${x.listing?.title ?? 'سفارش'} — نوع: ${listingTypeLabelFa(x.type)} — وضعیت: ${getOrderStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { orderId: x.id },
      })),
      ...tickets.map((x) => ({
        id: `ticket:${x.id}`,
        kind: 'TICKET' as const,
        title: 'تیکت پشتیبانی',
        subtitle: `${x.subject} — وضعیت: ${ticketStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { ticketId: x.id },
      })),
      ...offers.map((x) => ({
        id: `exchange-offer:${x.id}`,
        kind: 'EXCHANGE_OFFER' as const,
        title: 'پیشنهاد معاوضه',
        subtitle: `${x.title} — روی آگهی: ${x.listing.title} — وضعیت: ${exchangeOfferStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { exchangeOfferId: x.id },
      })),
      ...bids.map((x) => ({
        id: `auction-bid:${x.id}`,
        kind: 'AUCTION_BID' as const,
        title: 'پیشنهاد مزایده',
        subtitle: `${x.auction.listing.title} — مبلغ: ${x.amount.toString()} — وضعیت: ${auctionBidStatusLabelFa(x.status)}`,
        createdAt: x.createdAt,
        meta: { bidId: x.id },
      })),
      ...listingViews.map((x) => ({
        id: `listing-view:${x.id}`,
        kind: 'LISTING_VIEW' as const,
        title: 'مشاهده آگهی',
        subtitle: x.listing?.title ?? 'آگهی',
        createdAt: x.viewedAt,
        meta: { listingId: x.listing?.id },
      })),
    ];

    return items
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, take);
  }

  async loginLogs(
    actor: AuthenticatedUser,
    userId: string,
    limit = 50,
  ): Promise<
    Array<{
      id: string;
      method: string;
      ipAddress: string | null;
      userAgent: string | null;
      createdAt: Date;
    }>
  > {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const take = Math.max(
      1,
      Math.min(Number.isFinite(limit) ? limit : 50, 100),
    );

    return this.prisma.userLoginLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        method: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    });
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
