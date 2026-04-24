import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
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
    };
    return allowed[sortBy ?? ''] ?? { createdAt: dir };
  }
}
