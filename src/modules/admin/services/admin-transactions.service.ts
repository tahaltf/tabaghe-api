import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminTransactionListQueryDto } from '../dto/admin-query.dto';

const TX_INCLUDE = {
  wallet: {
    select: {
      userId: true,
      user: {
        select: { id: true, phone: true, firstName: true, lastName: true, displayName: true },
      },
    },
  },
} satisfies Prisma.WalletTransactionInclude;

export type AdminTransactionItem = Prisma.WalletTransactionGetPayload<{
  include: typeof TX_INCLUDE;
}>;

@Injectable()
export class AdminTransactionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminTransactionListQueryDto,
  ): Promise<PaginatedResult<AdminTransactionItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.WalletTransactionWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.userId) where.wallet = { userId: query.userId };
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { referenceId: { contains: s } },
        { wallet: { user: { phone: { contains: s } } } },
        {
          wallet: { user: { firstName: { contains: s, mode: 'insensitive' } } },
        },
        {
          wallet: { user: { lastName: { contains: s, mode: 'insensitive' } } },
        },
      ];
    }

    const dir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.WalletTransactionOrderByWithRelationInput = {
      createdAt: dir,
    };

    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: TX_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }
}
