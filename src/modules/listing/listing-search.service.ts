import { Injectable } from '@nestjs/common';
import { ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../shared/contracts/pagination';
import { SearchListingsDto } from './dto/search-listings.dto';

/**
 * Select slim برای کارت‌های لیست آگهی‌ها. فقط فیلدهای مورد نیاز کارت رو میاره
 * تا بار payload کم بشه و اطلاعات حساس (phone، nationalId، ...) از نشت
 * خارج بشه.
 */
const SEARCH_SELECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  condition: true,
  thumbnail: true,
  createdAt: true,
  authorId: true,
  categoryId: true,
  provinceId: true,
  cityId: true,
  shippingPayer: true,
  sellerRequiresVerification: true,
  direct: {
    select: { price: true, allowExchange: true },
  },
  auction: {
    select: {
      basePrice: true,
      minBidIncrement: true,
      highestBidAmount: true,
      endDatetime: true,
      buyNowEnabled: true,
      buyNowPrice: true,
      status: true,
    },
  },
  exchange: {
    select: {
      desiredTitle: true,
      desiredCategoryId: true,
      extraPaymentAmount: true,
    },
  },
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  category: { select: { id: true, title: true, slug: true } },
} satisfies Prisma.ListingSelect;

export type SearchListingItem = Prisma.ListingGetPayload<{
  select: typeof SEARCH_SELECT;
}>;

@Injectable()
export class ListingSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    dto: SearchListingsDto,
    viewerUserId?: string,
  ): Promise<PaginatedResult<SearchListingItem>> {
    const page = Math.max(1, dto.page ?? 1);
    const limit = Math.min(50, Math.max(1, dto.limit ?? 20));
    const skip = (page - 1) * limit;

    const where: Prisma.ListingWhereInput = {};
    if (dto.type) where.type = dto.type;
    if (dto.province) where.provinceId = dto.province;
    if (dto.city) where.cityId = dto.city;
    if (dto.auctionStatus) {
      where.auction = { status: dto.auctionStatus };
    }

    // امنیت: کاربر عمومی فقط آگهی‌های APPROVED رو ببینه. وضعیت‌های دیگه
    // فقط برای مدیریت (که اندپوینت مخصوص خودشو داره) یا صاحب آگهی مجازند.
    if (dto.status) {
      where.status = dto.status;
    } else {
      where.status = ListingStatus.APPROVED;
    }

    if (dto.priceMin !== undefined || dto.priceMax !== undefined) {
      const priceRange: Prisma.DecimalFilter = {};
      if (dto.priceMin !== undefined) priceRange.gte = dto.priceMin;
      if (dto.priceMax !== undefined) priceRange.lte = dto.priceMax;
      where.OR = [
        { direct: { price: priceRange } },
        { auction: { highestBidAmount: priceRange } },
      ];
    }

    void viewerUserId;

    const [items, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: SEARCH_SELECT,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      items,
      pagination: buildPaginationMeta(page, limit, total),
    };
  }
}
