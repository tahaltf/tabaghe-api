import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminOrderListQueryDto } from '../dto/admin-query.dto';

const ORDER_LIST_INCLUDE = {
  listing: { select: { id: true, title: true, type: true, thumbnail: true } },
  buyer: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
  seller: {
    select: { id: true, firstName: true, lastName: true, phone: true },
  },
} satisfies Prisma.OrderInclude;

export type AdminOrderItem = Prisma.OrderGetPayload<{ include: typeof ORDER_LIST_INCLUDE }>;

@Injectable()
export class AdminOrdersQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: AdminOrderListQueryDto): Promise<PaginatedResult<AdminOrderItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { id: { contains: s } },
        { trackingCode: { contains: s } },
        { listing: { title: { contains: s, mode: 'insensitive' } } },
        { buyer: { phone: { contains: s } } },
        { seller: { phone: { contains: s } } },
      ];
    }

    const dir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      query.sortBy === 'updatedAt' ? { updatedAt: dir } : { createdAt: dir };

    const [items, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        include: ORDER_LIST_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            id: true, title: true, type: true, thumbnail: true, gallery: true,
            category: { select: { id: true, title: true } },
            direct: { select: { price: true } },
            auction: { select: { basePrice: true, highestBidAmount: true } },
          },
        },
        buyer: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            nationalCode: true, avatar: true,
          },
        },
        seller: {
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            shabaNumber: true, avatar: true,
          },
        },
        reviews: true,
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    return order;
  }
}
