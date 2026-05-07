import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
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

export type AdminUserListItem = Prisma.UserGetPayload<{ select: typeof USER_LIST_SELECT }>;
export type AdminUserDetail = Prisma.UserGetPayload<{ include: typeof USER_DETAIL_INCLUDE }>;
export interface AdminUserActivityItem {
  id: string;
  kind: 'LISTING' | 'ORDER_BUY' | 'ORDER_SELL' | 'TICKET' | 'EXCHANGE_OFFER' | 'AUCTION_BID';
  title: string;
  subtitle: string;
  createdAt: Date;
  meta?: Record<string, unknown>;
}
const ADMIN_DEFAULT_PASSWORD = '@Ab123456789@';

@Injectable()
export class AdminUsersQueryService {
  constructor(private readonly prisma: PrismaService) {}

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

    const orderBy: Prisma.UserOrderByWithRelationInput = this.buildOrderBy(query.sortBy, query.sortDir);

    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: USER_LIST_SELECT,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(actor: AuthenticatedUser, userId: string): Promise<AdminUserDetail> {
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
    const nextRole = user.role === UserRole.USER ? UserRole.ADMIN : UserRole.USER;
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
      throw new ForbiddenException('فقط گاد ادمین می‌تواند وضعیت حساب را تغییر دهد');
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

    return this.prisma.user.update({
      where: { id: userId },
      data: { rating },
      select: { id: true, rating: true },
    });
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
      actor.role === UserRole.GODADMIN
        ? requestedRole
        : UserRole.USER;
    if (actor.role !== UserRole.GODADMIN && requestedRole !== UserRole.USER) {
      throw new ForbiddenException('ادمین فقط می‌تواند کاربر عادی ایجاد کند');
    }

    const existing = await this.prisma.user.findUnique({
      where: { phone },
      select: { id: true },
    });
    if (existing) {
      throw new BadRequestException('کاربری با این شماره موبایل قبلاً ثبت شده است');
    }

    const rawPassword = (input.password?.trim() || ADMIN_DEFAULT_PASSWORD);
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
      select: { id: true, role: true, firstName: true, lastName: true, phone: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    this.assertCanManageTarget(actor, user.role);

    const take = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 100));
    const [listings, buyerOrders, sellerOrders, tickets, offers, bids] = await Promise.all([
      this.prisma.listing.findMany({
        where: { authorId: userId },
        select: { id: true, title: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.order.findMany({
        where: { buyerId: userId },
        select: { id: true, status: true, type: true, listing: { select: { title: true } }, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.order.findMany({
        where: { sellerId: userId },
        select: { id: true, status: true, type: true, listing: { select: { title: true } }, createdAt: true },
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
        select: { id: true, status: true, title: true, listing: { select: { title: true } }, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      this.prisma.auctionBid.findMany({
        where: { bidderId: userId },
        select: { id: true, amount: true, status: true, auction: { select: { listing: { select: { title: true } } } }, createdAt: true },
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

  private assertCanManageTarget(actor: AuthenticatedUser, targetRole: UserRole): void {
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
    };
    return allowed[sortBy ?? ''] ?? { createdAt: dir };
  }
}
