import { Injectable, NotFoundException } from '@nestjs/common';
import { ListingStatus, NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';
import { AdminListingListQueryDto } from '../dto/admin-query.dto';
import { ListingExpiryService } from '../../listing/services/listing-expiry.service';
import { AdminUserPlanLookupService } from './admin-user-plan-lookup.service';
import { NotificationService } from '../../notification/notification.service';
import type { AdminUserPlanInfo } from './admin-user-plan-lookup.service';

const LISTING_LIST_INCLUDE = {
  category: { select: { id: true, title: true } },
  province: { select: { id: true, name: true } },
  city: { select: { id: true, name: true } },
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      displayName: true,
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
  mergeGroup: {
    select: {
      id: true,
      _count: { select: { listings: true } },
    },
  },
  _count: { select: { variations: true } },
} satisfies Prisma.ListingInclude;

type AdminListingAuthor = Prisma.ListingGetPayload<{
  include: typeof LISTING_LIST_INCLUDE;
}>['author'] & { activePlan: AdminUserPlanInfo | null };

export type AdminListingItem = Omit<
  Prisma.ListingGetPayload<{ include: typeof LISTING_LIST_INCLUDE }>,
  'author'
> & { author: AdminListingAuthor };

@Injectable()
export class AdminListingsQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingExpiry: ListingExpiryService,
    private readonly userPlanLookup: AdminUserPlanLookupService,
    private readonly notificationService: NotificationService,
  ) {}

  private async attachAuthorPlans<
    T extends { author: { id: string } },
  >(items: T[]): Promise<Array<T & { author: T['author'] & { activePlan: AdminUserPlanInfo | null } }>> {
    const userIds = [...new Set(items.map((i) => i.author.id))];
    const planByUser = await this.userPlanLookup.loadActivePlansForUsers(userIds);
    return items.map((item) => ({
      ...item,
      author: {
        ...item.author,
        activePlan: planByUser.get(item.author.id) ?? null,
      },
    }));
  }

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
    if (query.importSource) where.importSource = query.importSource;
    if (query.isVariable !== undefined) where.isVariable = query.isVariable;
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

    const [rawItems, total] = await Promise.all([
      this.prisma.listing.findMany({
        where,
        include: LISTING_LIST_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      this.prisma.listing.count({ where }),
    ]);

    const items = await this.attachAuthorPlans(rawItems);

    return {
      items: items.map((item) => ({
        ...item,
        mergeGroupMemberCount: item.mergeGroup?._count?.listings ?? 0,
        isMerged: Boolean(item.mergeGroupId),
        variationCount: item._count?.variations ?? 0,
      })),
      pagination: buildPaginationMeta(page, pageSize, total),
    };
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
        variations: {
          orderBy: { sortOrder: 'asc' },
        },
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
        purchaseOffers: {
          orderBy: { createdAt: 'desc' },
          include: {
            buyer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                displayName: true,
                phone: true,
              },
            },
          },
        },
        orders: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    const [enriched] = await this.attachAuthorPlans([listing]);
    return enriched;
  }

  async setStatus(id: string, status: ListingStatus) {
    const before = await this.prisma.listing.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, authorId: true, type: true },
    });
    if (!before) throw new NotFoundException('آگهی یافت نشد');

    const data: Prisma.ListingUpdateInput = { status };
    if (status === ListingStatus.APPROVED) {
      const approvedAt = new Date();
      const expiryFields = await this.listingExpiry.approvalExpiryFields(approvedAt);
      data.approvedAt = approvedAt;
      data.expiresAt = expiryFields.expiresAt as Date;
      data.expiryReminderSentAt = null;
    }
    const updated = await this.prisma.listing.update({
      where: { id },
      data,
    });

    if (
      status === ListingStatus.APPROVED &&
      before.status !== ListingStatus.APPROVED
    ) {
      await this.notificationService.create({
        userId: before.authorId,
        type: NotificationType.LISTING_APPROVED,
        title: 'آگهی شما تایید شد',
        message: `آگهی «${before.title}» توسط ادمین تایید و منتشر شد.`,
        meta: { listingId: updated.id, listingType: before.type },
      });
    }

    return updated;
  }

  /**
   * نشان دادن/برداشتن وضعیت ویژهٔ یک آگهی توسط ادمین.
   * - با ست‌شدن، featuredAt به now تنظیم می‌شود تا مرتب‌سازی ثانویه روی آگهی‌های ویژه هم برقرار باشد.
   * - با برداشتن، featuredAt به null برمی‌گردد.
   */
  async setFeatured(id: string, isFeatured: boolean) {
    return this.prisma.listing.update({
      where: { id },
      data: {
        isFeatured,
        featuredAt: isFeatured ? new Date() : null,
      },
    });
  }
}
