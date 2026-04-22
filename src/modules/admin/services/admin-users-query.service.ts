import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminUserListQueryDto } from '../dto/admin-query.dto';

const USER_LIST_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  status: true,
  role: true,
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

@Injectable()
export class AdminUsersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminUserListQueryDto): Promise<PaginatedResult<AdminUserListItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.UserWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.role) where.role = query.role;
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

  async detail(userId: string): Promise<AdminUserDetail> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: USER_DETAIL_INCLUDE,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return user;
  }

  async toggleRole(userId: string): Promise<{ id: string; role: UserRole }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    const nextRole = user.role === UserRole.ADMIN ? UserRole.USER : UserRole.ADMIN;
    return this.prisma.user.update({
      where: { id: userId },
      data: { role: nextRole },
      select: { id: true, role: true },
    });
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
