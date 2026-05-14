import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminListingListQueryDto } from '../dto/admin-query.dto';

const LISTING_LIST_INCLUDE = {
  category: { select: { id: true, title: true } },
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      isVerified: true,
    },
  },
  direct: {
    select: { price: true, allowExchange: true, shippingMethods: true },
  },
  auction: {
    select: { basePrice: true, buyNowPrice: true, endDatetime: true },
  },
  exchange: {
    select: {
      desiredCategoryId: true,
      desiredTitle: true,
      desiredDescription: true,
      ownValue: true,
      extraPaymentAmount: true,
      acceptOtherItems: true,
      allowDirectSale: true,
      directPrice: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type AdminListingItem = Prisma.ListingGetPayload<{
  include: typeof LISTING_LIST_INCLUDE;
}>;

@Injectable()
export class AdminListingsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: AdminListingListQueryDto,
  ): Promise<PaginatedResult<AdminListingItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where: Prisma.ListingWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.provinceId) where.provinceId = query.provinceId;
    if (query.search) {
      const s = query.search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { author: { phone: { contains: s } } },
      ];
    }

    const dir: 'asc' | 'desc' = query.sortDir === 'asc' ? 'asc' : 'desc';
    const orderBy: Prisma.ListingOrderByWithRelationInput =
      query.sortBy === 'updatedAt' ? { updatedAt: dir } : { createdAt: dir };

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: LISTING_LIST_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async detail(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        category: { select: { id: true, title: true } },
        province: { select: { id: true, name: true } },
        city: { select: { id: true, name: true } },
        author: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            phone: true,
            email: true,
            avatar: true,
            isVerified: true,
          },
        },
        direct: true,
        exchange: true,
        auction: {
          include: {
            highestBidder: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
            bids: {
              orderBy: { createdAt: 'desc' },
              take: 20,
              include: {
                bidder: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    phone: true,
                  },
                },
              },
            },
          },
        },
        exchangeOffers: {
          orderBy: { createdAt: 'desc' },
          include: {
            offerer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
              },
            },
          },
        },
        order: true,
      },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    return listing;
  }

  async setStatus(id: string, status: ListingStatus) {
    const data: Prisma.ListingUpdateInput = { status };
    if (status === ListingStatus.APPROVED) data.approvedAt = new Date();
    return this.prisma.listing.update({
      where: { id },
      data,
    });
  }
}
