import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';

const SAVED_LISTING_INCLUDE = {
  category: { select: { id: true, title: true, slug: true } },
  author: {
    select: { id: true, firstName: true, lastName: true, displayName: true, avatar: true },
  },
  direct: { select: { price: true, allowExchange: true } },
  auction: {
    select: {
      basePrice: true,
      highestBidAmount: true,
      endDatetime: true,
      status: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type SavedListing = Prisma.ListingGetPayload<{
  include: typeof SAVED_LISTING_INCLUDE;
}>;

@Injectable()
export class ListingSavedService {
  constructor(private readonly prisma: PrismaService) {}

  async toggle(userId: string, listingId: string): Promise<{ saved: boolean }> {
    const existing = await this.prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.savedListing.delete({ where: { id: existing.id } });
      return { saved: false };
    }
    await this.prisma.savedListing.create({ data: { userId, listingId } });
    return { saved: true };
  }

  async listForUser(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<PaginatedResult<SavedListing>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.savedListing.findMany({
        where,
        include: { listing: { include: SAVED_LISTING_INCLUDE } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.savedListing.count({ where }),
    ]);

    return {
      items: rows.map((s) => s.listing),
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  async isSaved(
    userId: string,
    listingId: string,
  ): Promise<{ saved: boolean }> {
    const existing = await this.prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } },
      select: { id: true },
    });
    return { saved: !!existing };
  }
}
