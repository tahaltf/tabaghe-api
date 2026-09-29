import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminListQueryDto } from '../dto/admin-query.dto';

const PRODUCT_REQUEST_INCLUDE = {
  user: {
    select: {
      id: true,
      phone: true,
      firstName: true,
      lastName: true,
      displayName: true,
    },
  },
  category: {
    select: {
      id: true,
      title: true,
      parent: { select: { id: true, title: true } },
    },
  },
} satisfies Prisma.ProductRequestInclude;

export type AdminProductRequestItem = Prisma.ProductRequestGetPayload<{
  include: typeof PRODUCT_REQUEST_INCLUDE;
}>;

@Injectable()
export class AdminProductRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminListQueryDto,
  ): Promise<PaginatedResult<AdminProductRequestItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ProductRequestWhereInput = {};
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { trackingCode: { contains: s, mode: 'insensitive' } },
        { title: { contains: s, mode: 'insensitive' } },
        { brand: { contains: s, mode: 'insensitive' } },
        { model: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { user: { phone: { contains: s } } },
        { user: { firstName: { contains: s, mode: 'insensitive' } } },
        { user: { lastName: { contains: s, mode: 'insensitive' } } },
        { user: { displayName: { contains: s, mode: 'insensitive' } } },
      ];
    }

    const [items, total] = await Promise.all([
      this.prisma.productRequest.findMany({
        where,
        include: PRODUCT_REQUEST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.productRequest.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string): Promise<AdminProductRequestItem> {
    const item = await this.prisma.productRequest.findUnique({
      where: { id },
      include: PRODUCT_REQUEST_INCLUDE,
    });
    if (!item) throw new NotFoundException('درخواست کالا یافت نشد');
    return item;
  }
}
