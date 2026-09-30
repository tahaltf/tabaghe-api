import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ListingStatus,
  ListingType,
  OrderStatus,
  Prisma,
  PurchaseOfferStatus,
  UserRole,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../../infrastructure/cache/ttl-cache.service';
import { CategoryTreeCacheService } from '../../../common/category/category-tree-cache.service';
import { ensureUserShopSlug } from '../../../common/user/shop-slug.util';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { ListListingsDto } from '../dto/list-listings.dto';
import type { PublicSellerQueryDto } from '../dto/public-seller-query.dto';
import type { HomeFeedResponse } from '../../../shared/contracts/home-feed';
import { HOME_JEWELRY_CATEGORY_SLUG } from '../../../common/category/home-category-slugs';
import {
  searchDigitVariants,
  toLatinDigits,
} from '../utils/search-digit-variants.util';

export type ListingSuggestItem = {
  id: string;
  title: string;
  thumbnail: string | null;
  type: ListingType;
  direct: { price: Prisma.Decimal; salePrice: Prisma.Decimal | null } | null;
  auction: { basePrice: Prisma.Decimal } | null;
};

/**
 * لیست آگهی‌ها فقط فیلدهای مورد نیاز کارت را برمیگرداند تا حجم payload
 * حداقلی باشه. فیلدهای حساس (phone صاحب آگهی، sellerRevenue، ...) لو نمی‌ره.
 * از root `select` استفاده می‌شود تا description/gallery/attributes برنگردند.
 */
const LIST_ITEM_SELECT = {
  id: true,
  title: true,
  type: true,
  status: true,
  condition: true,
  thumbnail: true,
  createdAt: true,
  approvedAt: true,
  expiresAt: true,
  authorId: true,
  categoryId: true,
  provinceId: true,
  cityId: true,
  shippingPayer: true,
  sellerRequiresVerification: true,
  testPeriodDays: true,
  isFeatured: true,
  featuredAt: true,
  stockQuantity: true,
  exchangeOffersSince: true,
  mergeGroupId: true,
  direct: {
    select: {
      price: true,
      salePrice: true,
      compareAtPrice: true,
      allowExchange: true,
    },
  },
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
  category: {
    select: {
      id: true,
      title: true,
      slug: true,
      verificationEnabled: true,
    },
  },
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatar: true,
      isVerified: true,
      isApproved: true,
    },
  },
} satisfies Prisma.ListingSelect;

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
            select: { id: true, firstName: true, lastName: true, displayName: true, avatar: true },
          },
        },
      },
    },
  },
  exchange: true,
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  category: {
    select: {
      id: true,
      title: true,
      verificationEnabled: true,
      parent: {
        select: {
          id: true,
          title: true,
          parent: { select: { id: true, title: true } },
        },
      },
    },
  },
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
      avatar: true,
      isVerified: true,
      isApproved: true,
      rating: true,
      isOnline: true,
    },
  },
} satisfies Prisma.ListingInclude;

export type ListingListItem = Prisma.ListingGetPayload<{
  select: typeof LIST_ITEM_SELECT;
}>;
export type ListingDetail = Prisma.ListingGetPayload<{
  include: typeof DETAIL_INCLUDE;
}>;

@Injectable()
export class ListingQueryService {
  private static readonly HOME_FEED_CACHE_TTL_SECONDS = 45;

  constructor(
    private readonly prisma: PrismaService,
    private readonly categoryTree: CategoryTreeCacheService,
    private readonly cache: TtlCacheService,
  ) {}

  async findAll(
    query: ListListingsDto,
  ): Promise<PaginatedResult<ListingListItem>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const where = await this.buildPublicWhere(query);
    const orderBy = this.buildOrderBy(query.sort);

    const useRelevanceSort =
      !!query.search?.trim() && (!query.sort || query.sort === 'newest');
    const takeForRanking = useRelevanceSort
      ? Math.max(pageSize * 4, 60)
      : pageSize;
    const [rawItems, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        select: LIST_ITEM_SELECT,
        // آگهی‌های ویژه همیشه بالاتر قرار می‌گیرند، سپس مرتب‌سازی انتخابی کاربر اعمال می‌شود.
        orderBy: [{ isFeatured: 'desc' }, { featuredAt: 'desc' }, ...orderBy],
        skip: useRelevanceSort ? 0 : skip,
        take: takeForRanking,
      }),
      this.prisma.listing.count({ where }),
    ]);
    const items = useRelevanceSort
      ? this.rankFeaturedAndRelevance(query.search ?? '', rawItems).slice(
          skip,
          skip + pageSize,
        )
      : rawItems;

    return {
      items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  /** Autocomplete for search boxes — title + category (+ parent), with digit variants. */
  async suggest(
    query: string,
    limit = 8,
    typesCsv?: string,
  ): Promise<ListingSuggestItem[]> {
    const variants = searchDigitVariants(query);
    const searchOr = this.buildTextSearchOr(variants, {
      includeDescription: false,
      includeLocation: false,
    });
    if (!searchOr.length) return [];
    const take = Math.min(15, Math.max(1, limit));
    const types = this.parseSuggestTypes(typesCsv);
    return this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        OR: searchOr,
        ...(types.length ? { type: { in: types } } : {}),
      },
      select: {
        id: true,
        title: true,
        thumbnail: true,
        type: true,
        direct: { select: { price: true, salePrice: true } },
        auction: { select: { basePrice: true } },
      },
      orderBy: [
        { isFeatured: 'desc' },
        { featuredAt: 'desc' },
        { approvedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take,
    });
  }

  private parseSuggestTypes(typesCsv?: string): ListingType[] {
    if (!typesCsv?.trim()) return [];
    const allowed = new Set<string>(Object.values(ListingType));
    return typesCsv
      .split(',')
      .map((t) => t.trim().toUpperCase())
      .filter((t): t is ListingType => allowed.has(t));
  }

  async getHomeFeed(limit = 10): Promise<HomeFeedResponse> {
    const safeLimit = Math.min(20, Math.max(1, limit));
    return this.cache.getOrSet(
      `listings:home-feed:${safeLimit}`,
      ListingQueryService.HOME_FEED_CACHE_TTL_SECONDS,
      () => this.buildHomeFeed(safeLimit),
    );
  }

  private async buildHomeFeed(safeLimit: number): Promise<HomeFeedResponse> {
    const where = await this.buildPublicWhere({} as ListListingsDto);
    const directWhere = { ...where, type: ListingType.DIRECT };
    await this.applyCategoryExclusion(
      directWhere,
      HOME_JEWELRY_CATEGORY_SLUG,
    );
    const orderBy: Prisma.ListingOrderByWithRelationInput[] = [
      { isFeatured: 'desc' },
      { featuredAt: 'desc' },
      { approvedAt: 'desc' },
      { createdAt: 'desc' },
    ];

    const [auction, direct, exchange, auctions, total] = await Promise.all([
      this.prisma.listing.findMany({
        where: { ...where, type: ListingType.AUCTION },
        select: LIST_ITEM_SELECT,
        orderBy,
        take: safeLimit,
      }),
      this.prisma.listing.findMany({
        where: directWhere,
        select: LIST_ITEM_SELECT,
        orderBy,
        take: safeLimit,
      }),
      this.prisma.listing.findMany({
        where: {
          ...where,
          OR: [
            { type: ListingType.EXCHANGE },
            { direct: { allowExchange: true } },
          ],
        },
        select: LIST_ITEM_SELECT,
        orderBy,
        take: safeLimit,
      }),
      this.prisma.listing.count({
        where: { ...where, type: ListingType.AUCTION },
      }),
      this.prisma.listing.count({ where }),
    ]);

    return {
      auction,
      direct,
      exchange,
      stats: { total, auctions },
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
        orders: {
          where: {
            status: {
              in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT],
            },
          },
          select: { status: true, buyerId: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');

    const isStaff =
      viewerRole === UserRole.ADMIN || viewerRole === UserRole.GODADMIN;

    const checkoutOrder = listing.orders[0];
    if (checkoutOrder) {
      const os = checkoutOrder.status;
      const isExchangePending =
        listing.type === 'EXCHANGE' &&
        (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT);
      if (
        !isExchangePending &&
        (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT)
      ) {
        const isBuyer = viewerId && checkoutOrder.buyerId === viewerId;
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

    const { orders, ...listingWithoutOrder } = listing as typeof listing & {
      orders?: Array<{ status: OrderStatus; buyerId: string }>;
    };
    void orders;
    return listingWithoutOrder as ListingDetail;
  }

  async findAllByUser(
    userId: string,
    options: { page?: number; pageSize?: number; status?: string } = {},
  ): Promise<PaginatedResult<ListingListItem>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ListingWhereInput = { authorId: userId };
    const status = String(options.status ?? '').trim().toUpperCase();
    if (status && status !== 'ALL') {
      if (status === 'EXPIRED') {
        where.OR = [
          { status: ListingStatus.ARCHIVED },
          { status: ListingStatus.APPROVED, expiresAt: { lte: new Date() } },
        ];
      } else if (status === 'NON_DRAFT') {
        where.status = { not: ListingStatus.DRAFT };
      } else if (Object.values(ListingStatus).includes(status as ListingStatus)) {
        where.status = status as ListingStatus;
      }
    }
    const [rows, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        select: {
          ...LIST_ITEM_SELECT,
          rejectionReason: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);

    const exchangeListingIds = rows
      .filter(
        (item) =>
          item.type === ListingType.EXCHANGE ||
          Boolean(item.direct?.allowExchange),
      )
      .map((item) => item.id);

    const pendingCounts = new Map<string, number>();
    if (exchangeListingIds.length) {
      const sinceByListing = new Map(
        rows.map((row) => [row.id, row.exchangeOffersSince] as const),
      );
      const grouped = await this.prisma.exchangeOffer.groupBy({
        by: ['listingId'],
        where: {
          listingId: { in: exchangeListingIds },
          status: ExchangeOfferStatus.PENDING,
        },
        _count: { _all: true },
      });
      // groupBy cannot filter per-row `since`; apply since with a second light query only when needed
      const needsSinceFilter = rows.some(
        (r) =>
          exchangeListingIds.includes(r.id) && r.exchangeOffersSince != null,
      );
      if (needsSinceFilter) {
        const offers = await this.prisma.exchangeOffer.findMany({
          where: {
            listingId: { in: exchangeListingIds },
            status: ExchangeOfferStatus.PENDING,
          },
          select: { listingId: true, createdAt: true },
        });
        for (const offer of offers) {
          const since = sinceByListing.get(offer.listingId);
          if (since && offer.createdAt < since) continue;
          pendingCounts.set(
            offer.listingId,
            (pendingCounts.get(offer.listingId) ?? 0) + 1,
          );
        }
      } else {
        for (const row of grouped) {
          pendingCounts.set(row.listingId, row._count._all);
        }
      }
    }

    const directListingIds = rows
      .filter((item) => item.type === ListingType.DIRECT)
      .map((item) => item.id);
    const purchasePendingCounts = new Map<string, number>();
    if (directListingIds.length) {
      try {
        const grouped = await this.prisma.purchaseOffer.groupBy({
          by: ['listingId'],
          where: {
            listingId: { in: directListingIds },
            status: PurchaseOfferStatus.PENDING,
            expiresAt: { gt: new Date() },
          },
          _count: { _all: true },
        });
        for (const row of grouped) {
          purchasePendingCounts.set(row.listingId, row._count._all);
        }
      } catch {
        // جدول/اسکیما هنوز migrate نشده؛ لیست آگهی‌ها نباید خالی بماند
      }
    }

    const items = rows.map((item) => ({
      ...item,
      pendingExchangeOffersCount: pendingCounts.get(item.id) ?? 0,
      pendingPurchaseOffersCount: purchasePendingCounts.get(item.id) ?? 0,
      isMerged: Boolean(item.mergeGroupId),
    }));

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
        orders: {
          where: {
            status: {
              in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT],
            },
          },
          select: { status: true, buyerId: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!listing || listing.status !== ListingStatus.APPROVED) return false;

    const activePurchaseReservation = await this.prisma.purchaseOffer.findFirst({
      where: {
        listingId,
        status: PurchaseOfferStatus.ACCEPTED,
        reservedUntil: { gt: new Date() },
      },
      select: { buyerId: true },
    });
    if (activePurchaseReservation) {
      if (viewerId && activePurchaseReservation.buyerId === viewerId) {
        // ادامه می‌دهیم تا سفارش checkout هم چک شود
      } else {
        return false;
      }
    }

    const checkoutOrder = listing.orders[0];
    const os = checkoutOrder?.status;
    const isExchangePending =
      listing.type === 'EXCHANGE' &&
      (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT);
    if (
      !isExchangePending &&
      (os === OrderStatus.PENDING || os === OrderStatus.AWAITING_PAYMENT)
    ) {
      const buyerId = checkoutOrder?.buyerId;
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

  private async resolveCategoryDescendantIds(
    categoryId: string,
  ): Promise<string[]> {
    return this.categoryTree.resolveDescendantIds(categoryId);
  }

  private async applyCategoryExclusion(
    where: Prisma.ListingWhereInput,
    excludeSlug: string,
  ): Promise<void> {
    const excludedIds =
      await this.categoryTree.resolveDescendantIdsBySlug(excludeSlug);
    if (!excludedIds.length) return;

    const existing = where.categoryId;
    if (
      existing &&
      typeof existing === 'object' &&
      'in' in existing &&
      Array.isArray(existing.in)
    ) {
      where.categoryId = {
        in: existing.in.filter((id) => !excludedIds.includes(id)),
      };
      return;
    }

    where.categoryId = { notIn: excludedIds };
  }

  private async buildPublicWhere(
    query: ListListingsDto,
  ): Promise<Prisma.ListingWhereInput> {
    const where: Prisma.ListingWhereInput = {
      status: ListingStatus.APPROVED,
      NOT: {
        orders: {
          some: {
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
      },
    };

    if (query.provinceId) where.provinceId = query.provinceId;
    if (query.cityId) where.cityId = query.cityId;
    if (query.categoryId) {
      const categoryIds = await this.resolveCategoryDescendantIds(
        query.categoryId,
      );
      where.categoryId = { in: categoryIds };
    }
    if (query.excludeCategorySlug) {
      await this.applyCategoryExclusion(where, query.excludeCategorySlug);
    }
    if (query.type) where.type = query.type;
    if (query.condition) where.condition = query.condition;

    if (query.search) {
      const variants = searchDigitVariants(query.search);
      const searchOr = this.buildTextSearchOr(variants, {
        includeDescription: true,
        includeLocation: true,
      });
      if (searchOr.length) {
        where.OR = searchOr;
      }
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

  private buildOrderBy(
    sort?: string,
  ): Prisma.ListingOrderByWithRelationInput[] {
    switch (sort) {
      case 'price_asc':
        return [
          { direct: { price: 'asc' } },
          { approvedAt: 'desc' },
          { createdAt: 'desc' },
        ];
      case 'price_desc':
        return [
          { direct: { price: 'desc' } },
          { approvedAt: 'desc' },
          { createdAt: 'desc' },
        ];
      case 'oldest':
        return [{ approvedAt: 'asc' }, { createdAt: 'asc' }];
      default:
        // newest
        return [{ approvedAt: 'desc' }, { createdAt: 'desc' }];
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

  /**
   * هنگام جست‌وجو، آگهی‌های ویژه باید همچنان بالاتر بمانند ولی در داخل هر گروه
   * بر اساس نمرهٔ ربط مرتب شوند.
   */
  private rankFeaturedAndRelevance(
    search: string,
    items: ListingListItem[],
  ): ListingListItem[] {
    const q = this.normalize(search);
    return [...items].sort((a, b) => {
      const af = a.isFeatured ? 1 : 0;
      const bf = b.isFeatured ? 1 : 0;
      if (af !== bf) return bf - af;
      return this.relevanceScore(q, b) - this.relevanceScore(q, a);
    });
  }

  private relevanceScore(query: string, item: ListingListItem): number {
    const title = this.normalize(item.title);
    const category = this.normalize(item.category?.title ?? '');
    const city = this.normalize(item.city?.name ?? '');
    const province = this.normalize(item.province?.name ?? '');
    let score = 0;
    if (title.startsWith(query)) score += 90;
    if (title.includes(query)) score += 50;
    if (category.includes(query)) score += 30;
    if (city.includes(query) || province.includes(query)) score += 18;
    return score;
  }

  private buildTextSearchOr(
    variants: string[],
    opts: { includeDescription: boolean; includeLocation: boolean },
  ): Prisma.ListingWhereInput[] {
    const clauses: Prisma.ListingWhereInput[] = [];
    for (const v of variants) {
      if (v.length < 2) continue;
      const mode = 'insensitive' as const;
      clauses.push(
        { title: { contains: v, mode } },
        { category: { title: { contains: v, mode } } },
        { category: { parent: { title: { contains: v, mode } } } },
      );
      if (opts.includeDescription) {
        clauses.push({ description: { contains: v, mode } });
      }
      if (opts.includeLocation) {
        clauses.push(
          { city: { name: { contains: v, mode } } },
          { province: { name: { contains: v, mode } } },
        );
      }
    }
    return clauses;
  }

  private normalize(input: string): string {
    return toLatinDigits(String(input || ''))
      .toLowerCase()
      .replace(/ي/g, 'ی')
      .replace(/ك/g, 'ک')
      .trim();
  }

  async getOwnerStats(userId: string, listingId: string) {
    const listing = await this.prisma.listing.findFirst({
      where: { id: listingId, authorId: userId },
      select: { id: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    const [views, saves, messages] = await Promise.all([
      this.prisma.listingView.count({ where: { listingId } }),
      this.prisma.savedListing.count({ where: { listingId } }),
      this.prisma.message.count({
        where: { conversation: { listingId } },
      }),
    ]);
    return { views, saves, messages };
  }

  async getPublicSeller(sellerKey: string, query: PublicSellerQueryDto = { page: 1, pageSize: 12 }) {
    const key = decodeURIComponent(String(sellerKey ?? '')).trim();
    if (!key) throw new NotFoundException('فروشنده یافت نشد');

    const sellerSelect = {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
      avatar: true,
      bio: true,
      shopSlug: true,
      rating: true,
      isVerified: true,
    } as const;

    let user = await this.prisma.user.findUnique({
      where: { id: key },
      select: sellerSelect,
    });
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: { shopSlug: { equals: key, mode: 'insensitive' } },
        select: sellerSelect,
      });
    }
    if (!user) throw new NotFoundException('فروشنده یافت نشد');

    const shopSlug = await ensureUserShopSlug(this.prisma, user);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(24, Math.max(1, Number(query.pageSize) || 12));
    const skip = (page - 1) * pageSize;
    const listingWhere = {
      authorId: user.id,
      status: ListingStatus.APPROVED,
      deletedAt: null,
    };

    const [completedTrades, listings, total] = await Promise.all([
      this.prisma.order.count({
        where: {
          sellerId: user.id,
          status: OrderStatus.COMPLETED,
        },
      }),
      this.prisma.listing.findMany({
        where: listingWhere,
        select: LIST_ITEM_SELECT,
        orderBy: { approvedAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.listing.count({ where: listingWhere }),
    ]);
    return {
      seller: {
        id: user.id,
        displayName: user.displayName,
        firstName: user.firstName,
        lastName: user.lastName,
        avatar: user.avatar,
        bio: user.bio,
        shopSlug,
        rating: user.rating,
        isVerified: user.isVerified,
        completedTrades,
      },
      listings,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }
}
