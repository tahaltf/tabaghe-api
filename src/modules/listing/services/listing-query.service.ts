import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ListingStatus,
  ListingType,
  OrderStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { ListListingsDto } from '../dto/list-listings.dto';

/**
 * لیست آگهی‌ها فقط فیلدهای مورد نیاز کارت را برمیگرداند تا حجم payload
 * حداقلی باشه. فیلدهای حساس (phone صاحب آگهی، sellerRevenue، ...) لو نمی‌ره.
 */
const LIST_ITEM_INCLUDE = {
  direct: { select: { price: true, allowExchange: true } },
  auction: {
    select: {
      basePrice: true,
      highestBidAmount: true,
      endDatetime: true,
      status: true,
      buyNowEnabled: true,
      buyNowPrice: true,
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
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      isVerified: true,
    },
  },
} satisfies Prisma.ListingInclude;

/**
 * DETAIL_INCLUDE عمومی: شماره تلفن صاحب آگهی اینجا نباید لو بره. فقط
 * مالک و ادمین دسترسی به phone دارن که در findOne اضافه میشه.
 */
const DETAIL_INCLUDE = {
  direct: true,
  auction: {
    include: {
      bids: {
        orderBy: { amount: 'desc' },
        take: 10,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          bidder: {
            select: { id: true, firstName: true, lastName: true, avatar: true },
          },
        },
      },
    },
  },
  exchange: true,
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  category: { select: { id: true, title: true } },
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      avatar: true,
      isVerified: true,
      rating: true,
      isOnline: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type ListingListItem = Prisma.ListingGetPayload<{
  include: typeof LIST_ITEM_INCLUDE;
}>;
export type ListingDetail = Prisma.ListingGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

@Injectable()
export class ListingQueryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    query: ListListingsDto,
  ): Promise<PaginatedResult<ListingListItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where = this.buildPublicWhere(query);
    const orderBy = this.buildOrderBy(query.sort);

    const useRelevanceSort =
      !!query.search?.trim() && (!query.sort || query.sort === 'newest');
    const takeForRanking = useRelevanceSort
      ? Math.max(pageSize * 4, 60)
      : pageSize;
    const [rawItems, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: LIST_ITEM_INCLUDE,
        orderBy,
        skip: useRelevanceSort ? 0 : skip,
        take: takeForRanking,
      }),
      this.prisma.listing.count({ where }),
    ]);
    const items = useRelevanceSort
      ? this.rankByRelevance(query.search ?? '', rawItems).slice(
          skip,
          skip + pageSize,
        )
      : rawItems;

    return {
      items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  async findOne(
    id: string,
    viewerId?: string,
    viewerRole?: UserRole,
  ): Promise<ListingDetail> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        ...DETAIL_INCLUDE,
        order: { select: { status: true, buyerId: true } },
      },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    const isStaff =
      viewerRole === UserRole.ADMIN || viewerRole === UserRole.GODADMIN;

    if (listing.order) {
      const os = listing.order.status;
      const isExchangePending =
        listing.type === 'EXCHANGE' &&
        (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT);
      if (
        !isExchangePending &&
        (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT)
      ) {
        const isBuyer = viewerId && listing.order.buyerId === viewerId;
        const isSeller = viewerId && listing.authorId === viewerId;
        if (!isBuyer && !isSeller && !isStaff) {
          throw new NotFoundException('این آگهی در حال حاضر در دسترس نیست.');
        }
      }
    }

    if (listing.status !== ListingStatus.APPROVED) {
      const isOwner = viewerId && listing.authorId === viewerId;
      if (!isOwner && !isStaff) {
        throw new NotFoundException(
          'این آگهی هنوز منتشر نشده یا در دسترس نیست.',
        );
      }
    }

    // فقط مالک و ادمین phone صاحب آگهی رو ببینن. بقیه باید از طریق
    // چت داخل‌سایتی ارتباط بگیرن.
    const isOwner = viewerId && listing.authorId === viewerId;
    if (isOwner || isStaff) {
      const ownerPhone = await this.prisma.user.findUnique({
        where: { id: listing.authorId },
        select: { phone: true },
      });
      (
        listing as typeof listing & { author: { phone?: string | null } }
      ).author.phone = ownerPhone?.phone ?? null;
    }

    const { order, ...listingWithoutOrder } = listing as typeof listing & {
      order?: { status: OrderStatus; buyerId: string } | null;
    };
    void order;
    return listingWithoutOrder as ListingDetail;
  }

  async findAllByUser(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ): Promise<PaginatedResult<ListingListItem>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ListingWhereInput = { authorId: userId };
    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: LIST_ITEM_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  /**
   * برای فروش مستقیم/مزایده، وجود سفارش PENDING یا AWAITING_PAYMENT یعنی «رزرو checkout».
   * همان خریدار باید بتواند ادامهٔ پرداخت را بزند؛ بقیه نه.
   */
  async checkAvailability(
    listingId: string,
    viewerId?: string | null,
  ): Promise<boolean> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        type: true,
        status: true,
        order: { select: { status: true, buyerId: true } },
      },
    });
    if (!listing || listing.status !== ListingStatus.APPROVED) return false;
    const os = listing.order?.status;
    const isExchangePending =
      listing.type === 'EXCHANGE' &&
      (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT);
    if (
      !isExchangePending &&
      (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT)
    ) {
      const buyerId = listing.order?.buyerId;
      const sameBuyerContinuing =
        !!viewerId &&
        !!buyerId &&
        buyerId === viewerId &&
        (listing.type === ListingType.DIRECT ||
          listing.type === ListingType.AUCTION);
      if (sameBuyerContinuing) return true;
      return false;
    }
    return true;
  }

  getHubAddress() {
    return {
      title: 'انبار مرکزی طبقه',
      recipientName: 'واحد پردازش و کارشناسی',
      province: 'تهران',
      city: 'تهران',
      fullAddress: 'خیابان آزادی، پلاک ۱۱۰، واحد ۵',
      postalCode: '1234567890',
      phone: '02191000000',
    };
  }

  private buildPublicWhere(query: ListListingsDto): Prisma.ListingWhereInput {
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.APPROVED,
      NOT: {
        order: {
          AND: [
            {
              status: {
                in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT],
              },
            },
            {
              type: { not: 'EXCHANGE' },
            },
          ],
        },
      },
    };

    if (query.provinceId) where.provinceId = query.provinceId;
    if (query.cityId) where.cityId = query.cityId;
    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.type) where.type = query.type;
    if (query.condition) where.condition = query.condition;

    if (query.search) {
      const normalized = query.search.trim();
      where.OR = [
        { title: { contains: normalized, mode: 'insensitive' } },
        { description: { contains: normalized, mode: 'insensitive' } },
        { category: { title: { contains: normalized, mode: 'insensitive' } } },
        { city: { name: { contains: normalized, mode: 'insensitive' } } },
        { province: { name: { contains: normalized, mode: 'insensitive' } } },
      ];
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      const min = query.minPrice ?? 0;
      const max = query.maxPrice ?? Number.MAX_SAFE_INTEGER;
      where.AND = [
        {
          OR: [
            { direct: { price: { gte: min, lte: max } } },
            { auction: { basePrice: { gte: min, lte: max } } },
            { exchange: { ownValue: { gte: min, lte: max } } },
          ],
        },
      ];
    }

    return where;
  }

  private buildOrderBy(sort?: string): Prisma.ListingOrderByWithRelationInput {
    switch (sort) {
      case 'price_asc':
        return { direct: { price: 'asc' } };
      case 'price_desc':
        return { direct: { price: 'desc' } };
      case 'oldest':
        return { createdAt: 'asc' };
      default:
        return { createdAt: 'desc' };
    }
  }

  private rankByRelevance(
    search: string,
    items: ListingListItem[],
  ): ListingListItem[] {
    const q = this.normalize(search);
    return [...items].sort(
      (a, b) => this.relevanceScore(q, b) - this.relevanceScore(q, a),
    );
  }

  private relevanceScore(query: string, item: ListingListItem): number {
    const title = this.normalize(item.title);
    const description = this.normalize(item.description ?? '');
    const category = this.normalize(item.category?.title ?? '');
    const city = this.normalize(item.city?.name ?? '');
    const province = this.normalize(item.province?.name ?? '');
    let score = 0;
    if (title.startsWith(query)) score += 90;
    if (title.includes(query)) score += 50;
    if (category.includes(query)) score += 30;
    if (city.includes(query) || province.includes(query)) score += 18;
    if (description.includes(query)) score += 12;
    return score;
  }

  private normalize(input: string): string {
    return String(input || '')
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .trim();
  }
}
