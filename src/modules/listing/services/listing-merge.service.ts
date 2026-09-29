import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingMergeRequestStatus,
  ListingStatus,
  ListingType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  buildPaginationMeta,
  PaginatedResult,
} from '../../../shared/contracts/pagination';

const LISTING_SUMMARY_SELECT = {
  id: true,
  title: true,
  type: true,
  condition: true,
  status: true,
  thumbnail: true,
  mergeGroupId: true,
  authorId: true,
  direct: {
    select: {
      price: true,
      salePrice: true,
      compareAtPrice: true,
    },
  },
  auction: {
    select: {
      basePrice: true,
      highestBidAmount: true,
      buyNowPrice: true,
    },
  },
  exchange: {
    select: {
      ownValue: true,
      directPrice: true,
      allowDirectSale: true,
      extraPaymentAmount: true,
    },
  },
  author: {
    select: {
      id: true,
      displayName: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ListingSelect;

type ListingSummary = Prisma.ListingGetPayload<{
  select: typeof LISTING_SUMMARY_SELECT;
}>;

function toNumber(value: Prisma.Decimal | number | null | undefined): number | null {
  if (value == null) return null;
  return typeof value === 'number' ? value : Number(value);
}

/** قیمت نمایشی برای مرتب‌سازی و جدول مشابه */
export function resolveDisplayPrice(listing: ListingSummary): number | null {
  if (listing.type === ListingType.DIRECT && listing.direct) {
    return toNumber(listing.direct.salePrice ?? listing.direct.price);
  }
  if (listing.type === ListingType.AUCTION && listing.auction) {
    return toNumber(
      listing.auction.highestBidAmount ??
        listing.auction.buyNowPrice ??
        listing.auction.basePrice,
    );
  }
  if (listing.type === ListingType.EXCHANGE && listing.exchange) {
    if (listing.exchange.allowDirectSale && listing.exchange.directPrice != null) {
      return toNumber(listing.exchange.directPrice);
    }
    return toNumber(listing.exchange.ownValue);
  }
  return null;
}

/** قیمت قبل از تخفیف (برای خط‌خورده در UI) */
export function resolveDisplayCompareAt(listing: ListingSummary): number | null {
  if (listing.type !== ListingType.DIRECT || !listing.direct) return null;
  const sale = toNumber(listing.direct.salePrice);
  const price = toNumber(listing.direct.price);
  if (sale == null || price == null || sale <= 0 || price <= sale) return null;
  return price;
}

function mapListingCard(listing: ListingSummary) {
  const price = toNumber(listing.direct?.price ?? null);
  const salePrice = toNumber(listing.direct?.salePrice ?? null);
  const compareAtPrice = toNumber(listing.direct?.compareAtPrice ?? null);
  return {
    id: listing.id,
    title: listing.title,
    type: listing.type,
    condition: listing.condition,
    status: listing.status,
    thumbnail: listing.thumbnail,
    mergeGroupId: listing.mergeGroupId,
    displayPrice: resolveDisplayPrice(listing),
    displayCompareAt: resolveDisplayCompareAt(listing),
    direct: listing.direct
      ? {
          price,
          salePrice,
          compareAtPrice:
            compareAtPrice ??
            (salePrice != null && price != null && salePrice < price ? price : null),
        }
      : null,
    auction: listing.auction,
    exchange: listing.exchange,
    author: listing.author,
  };
}

@Injectable()
export class ListingMergeService {
  constructor(private readonly prisma: PrismaService) {}

  private async memberCountsByGroupIds(
    groupIds: Array<string | null | undefined>,
  ): Promise<Map<string, number>> {
    const ids = [...new Set(groupIds.filter((id): id is string => Boolean(id)))];
    const map = new Map<string, number>();
    if (!ids.length) return map;
    const grouped = await this.prisma.listing.groupBy({
      by: ['mergeGroupId'],
      where: { mergeGroupId: { in: ids } },
      _count: { _all: true },
    });
    for (const row of grouped) {
      if (row.mergeGroupId) map.set(row.mergeGroupId, row._count._all);
    }
    return map;
  }

  async createRequest(userId: string, sourceListingId: string, targetListingId: string) {
    if (sourceListingId === targetListingId) {
      throw new BadRequestException('نمی‌توانید یک آگهی را با خودش ادغام کنید');
    }

    const [source, target] = await Promise.all([
      this.prisma.listing.findUnique({
        where: { id: sourceListingId },
        select: {
          id: true,
          authorId: true,
          status: true,
          deletedAt: true,
          mergeGroupId: true,
        },
      }),
      this.prisma.listing.findUnique({
        where: { id: targetListingId },
        select: {
          id: true,
          status: true,
          deletedAt: true,
          mergeGroupId: true,
        },
      }),
    ]);

    if (!source || source.deletedAt) {
      throw new NotFoundException('آگهی مبدأ یافت نشد');
    }
    if (source.authorId !== userId) {
      throw new ForbiddenException('فقط برای آگهی خودتان می‌توانید درخواست ادغام ثبت کنید');
    }
    if (!target || target.deletedAt) {
      throw new NotFoundException('آگهی مقصد یافت نشد');
    }
    if (target.status !== ListingStatus.APPROVED) {
      throw new BadRequestException('آگهی مقصد باید منتشر شده باشد');
    }
    if (
      source.mergeGroupId &&
      target.mergeGroupId &&
      source.mergeGroupId === target.mergeGroupId
    ) {
      throw new BadRequestException('این دو آگهی از قبل در یک گروه ادغام هستند');
    }

    const existingPending = await this.prisma.listingMergeRequest.findFirst({
      where: {
        sourceListingId,
        status: ListingMergeRequestStatus.PENDING,
      },
      select: { id: true },
    });
    if (existingPending) {
      throw new BadRequestException('برای این آگهی یک درخواست ادغام در انتظار بررسی وجود دارد');
    }

    const created = await this.prisma.listingMergeRequest.create({
      data: {
        sourceListingId,
        requestedTargetListingId: targetListingId,
        requesterId: userId,
      },
      include: {
        sourceListing: { select: LISTING_SUMMARY_SELECT },
        requestedTargetListing: { select: LISTING_SUMMARY_SELECT },
      },
    });

    const counts = await this.memberCountsByGroupIds([
      created.sourceListing.mergeGroupId,
      created.requestedTargetListing.mergeGroupId,
    ]);

    return {
      ...created,
      sourceListing: {
        ...mapListingCard(created.sourceListing),
        memberCount: counts.get(created.sourceListing.mergeGroupId ?? '') ?? 0,
      },
      requestedTargetListing: {
        ...mapListingCard(created.requestedTargetListing),
        memberCount:
          counts.get(created.requestedTargetListing.mergeGroupId ?? '') ?? 0,
      },
    };
  }

  async listMyRequests(userId: string) {
    const rows = await this.prisma.listingMergeRequest.findMany({
      where: { requesterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        sourceListing: { select: LISTING_SUMMARY_SELECT },
        requestedTargetListing: { select: LISTING_SUMMARY_SELECT },
        finalTargetListing: { select: LISTING_SUMMARY_SELECT },
      },
    });
    return rows.map((row) => ({
      ...row,
      sourceListing: mapListingCard(row.sourceListing),
      requestedTargetListing: mapListingCard(row.requestedTargetListing),
      finalTargetListing: row.finalTargetListing
        ? mapListingCard(row.finalTargetListing)
        : null,
    }));
  }

  async cancelRequest(userId: string, requestId: string) {
    const req = await this.prisma.listingMergeRequest.findUnique({
      where: { id: requestId },
      select: { id: true, requesterId: true, status: true },
    });
    if (!req) throw new NotFoundException('درخواست یافت نشد');
    if (req.requesterId !== userId) {
      throw new ForbiddenException('اجازه لغو این درخواست را ندارید');
    }
    if (req.status !== ListingMergeRequestStatus.PENDING) {
      throw new BadRequestException('فقط درخواست در انتظار بررسی قابل لغو است');
    }
    return this.prisma.listingMergeRequest.update({
      where: { id: requestId },
      data: { status: ListingMergeRequestStatus.CANCELLED },
    });
  }

  async getSimilar(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: LISTING_SUMMARY_SELECT,
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (!listing.mergeGroupId) return { items: [] };

    const now = new Date();
    const activeWhere: Prisma.ListingWhereInput = {
      mergeGroupId: listing.mergeGroupId,
      status: ListingStatus.APPROVED,
      deletedAt: null,
      stockQuantity: { gt: 0 },
      AND: [
        {
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        {
          NOT: {
            orders: {
              some: {
                AND: [
                  {
                    status: {
                      in: [OrderStatus.PENDING, OrderStatus.AWAITING_PAYMENT],
                    },
                  },
                  { type: { not: 'EXCHANGE' } },
                ],
              },
            },
          },
        },
      ],
    };

    const siblings = await this.prisma.listing.findMany({
      where: {
        ...activeWhere,
        id: { not: listingId },
      },
      select: LISTING_SUMMARY_SELECT,
    });

    // بدون هم‌گروه فعال دیگر، جدول نشان داده نمی‌شود
    if (!siblings.length) return { items: [] };

    const items = [
      { ...mapListingCard(listing), isCurrent: true },
      ...siblings.map((row) => ({ ...mapListingCard(row), isCurrent: false })),
    ].sort((a, b) => {
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      const pa = a.displayPrice ?? Number.POSITIVE_INFINITY;
      const pb = b.displayPrice ?? Number.POSITIVE_INFINITY;
      return pa - pb;
    });

    return { items };
  }

  async listAdminRequests(options: {
    status?: ListingMergeRequestStatus;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedResult<unknown>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, options.pageSize ?? 20));
    const skip = (page - 1) * pageSize;
    const where: Prisma.ListingMergeRequestWhereInput = {};
    if (options.status) where.status = options.status;

    const [rows, total] = await Promise.all([
      this.prisma.listingMergeRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: {
          sourceListing: { select: LISTING_SUMMARY_SELECT },
          requestedTargetListing: { select: LISTING_SUMMARY_SELECT },
          finalTargetListing: { select: LISTING_SUMMARY_SELECT },
          requester: {
            select: {
              id: true,
              displayName: true,
              firstName: true,
              lastName: true,
              phone: true,
            },
          },
        },
      }),
      this.prisma.listingMergeRequest.count({ where }),
    ]);

    const counts = await this.memberCountsByGroupIds(
      rows.flatMap((r) => [
        r.sourceListing.mergeGroupId,
        r.requestedTargetListing.mergeGroupId,
        r.finalTargetListing?.mergeGroupId,
      ]),
    );

    const items = rows.map((row) => ({
      ...row,
      sourceListing: {
        ...mapListingCard(row.sourceListing),
        memberCount: counts.get(row.sourceListing.mergeGroupId ?? '') ?? 0,
      },
      requestedTargetListing: {
        ...mapListingCard(row.requestedTargetListing),
        memberCount:
          counts.get(row.requestedTargetListing.mergeGroupId ?? '') ?? 0,
      },
      finalTargetListing: row.finalTargetListing
        ? {
            ...mapListingCard(row.finalTargetListing),
            memberCount:
              counts.get(row.finalTargetListing.mergeGroupId ?? '') ?? 0,
          }
        : null,
    }));

    return { items, pagination: buildPaginationMeta(page, pageSize, total) };
  }

  async countPendingRequests(): Promise<number> {
    return this.prisma.listingMergeRequest.count({
      where: { status: ListingMergeRequestStatus.PENDING },
    });
  }

  /**
   * ادغام دو (یا چند) آگهی طبق قوانین پلن.
   * مقصد لنگر است؛ در صورت وجود گروه روی مقصد، بقیه به آن می‌پیوندند.
   */
  async mergeListings(listingIds: string[], preferredTargetId?: string) {
    const uniqueIds = [...new Set(listingIds.filter(Boolean))];
    if (uniqueIds.length < 2) {
      throw new BadRequestException('حداقل دو آگهی برای ادغام لازم است');
    }

    const listings = await this.prisma.listing.findMany({
      where: { id: { in: uniqueIds }, deletedAt: null },
      select: { id: true, mergeGroupId: true },
    });
    if (listings.length !== uniqueIds.length) {
      throw new NotFoundException('یک یا چند آگهی یافت نشد');
    }

    const targetId =
      preferredTargetId && uniqueIds.includes(preferredTargetId)
        ? preferredTargetId
        : uniqueIds[0];
    const target = listings.find((l) => l.id === targetId)!;
    const others = listings.filter((l) => l.id !== targetId);

    return this.prisma.$transaction(async (tx) => {
      let groupId = target.mergeGroupId;

      if (!groupId) {
        // اگر یکی از دیگران گروه دارد، از بزرگ‌ترین گروه استفاده کن؛ وگرنه گروه جدید
        const otherGroupIds = [
          ...new Set(
            others.map((o) => o.mergeGroupId).filter((id): id is string => Boolean(id)),
          ),
        ];
        if (otherGroupIds.length === 1) {
          groupId = otherGroupIds[0];
          await tx.listing.update({
            where: { id: targetId },
            data: { mergeGroupId: groupId },
          });
        } else if (otherGroupIds.length > 1) {
          const counts = await tx.listing.groupBy({
            by: ['mergeGroupId'],
            where: { mergeGroupId: { in: otherGroupIds } },
            _count: { _all: true },
          });
          counts.sort((a, b) => b._count._all - a._count._all);
          groupId = counts[0]?.mergeGroupId ?? otherGroupIds[0];
          await tx.listing.update({
            where: { id: targetId },
            data: { mergeGroupId: groupId },
          });
        } else {
          const group = await tx.listingMergeGroup.create({ data: {} });
          groupId = group.id;
          await tx.listing.update({
            where: { id: targetId },
            data: { mergeGroupId: groupId },
          });
        }
      }

      // همه آگهی‌های گروه‌های دیگر را به گروه مقصد منتقل کن
      const groupsToAbsorb = [
        ...new Set(
          others
            .map((o) => o.mergeGroupId)
            .filter((id): id is string => Boolean(id) && id !== groupId),
        ),
      ];

      if (groupsToAbsorb.length) {
        await tx.listing.updateMany({
          where: { mergeGroupId: { in: groupsToAbsorb } },
          data: { mergeGroupId: groupId },
        });
      }

      // آن‌هایی که هنوز گروه ندارند
      const stillUngrouped = others
        .filter((o) => !o.mergeGroupId)
        .map((o) => o.id);

      if (stillUngrouped.length) {
        await tx.listing.updateMany({
          where: { id: { in: stillUngrouped } },
          data: { mergeGroupId: groupId },
        });
      }

      // پاکسازی گروه‌های خالی
      if (groupsToAbsorb.length) {
        for (const oldId of groupsToAbsorb) {
          const left = await tx.listing.count({ where: { mergeGroupId: oldId } });
          if (left === 0) {
            await tx.listingMergeGroup.delete({ where: { id: oldId } }).catch(() => undefined);
          }
        }
      }

      const memberCount = await tx.listing.count({ where: { mergeGroupId: groupId } });
      return { mergeGroupId: groupId, memberCount };
    });
  }

  async approveRequest(
    adminId: string,
    requestId: string,
    overrideTargetListingId?: string,
    adminNote?: string,
  ) {
    const req = await this.prisma.listingMergeRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        status: true,
        sourceListingId: true,
        requestedTargetListingId: true,
      },
    });
    if (!req) throw new NotFoundException('درخواست یافت نشد');
    if (req.status !== ListingMergeRequestStatus.PENDING) {
      throw new BadRequestException('این درخواست دیگر در انتظار بررسی نیست');
    }

    const finalTargetId = overrideTargetListingId || req.requestedTargetListingId;
    if (finalTargetId === req.sourceListingId) {
      throw new BadRequestException('مقصد نمی‌تواند همان مبدأ باشد');
    }

    const targetExists = await this.prisma.listing.findFirst({
      where: { id: finalTargetId, deletedAt: null },
      select: { id: true },
    });
    if (!targetExists) throw new NotFoundException('آگهی مقصد یافت نشد');

    const mergeResult = await this.mergeListings(
      [req.sourceListingId, finalTargetId],
      finalTargetId,
    );

    const updated = await this.prisma.listingMergeRequest.update({
      where: { id: requestId },
      data: {
        status: ListingMergeRequestStatus.APPROVED,
        finalTargetListingId: finalTargetId,
        adminNote: adminNote?.trim() || null,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });

    return { ...updated, merge: mergeResult };
  }

  async rejectRequest(adminId: string, requestId: string, adminNote?: string) {
    const req = await this.prisma.listingMergeRequest.findUnique({
      where: { id: requestId },
      select: { id: true, status: true },
    });
    if (!req) throw new NotFoundException('درخواست یافت نشد');
    if (req.status !== ListingMergeRequestStatus.PENDING) {
      throw new BadRequestException('این درخواست دیگر در انتظار بررسی نیست');
    }
    return this.prisma.listingMergeRequest.update({
      where: { id: requestId },
      data: {
        status: ListingMergeRequestStatus.REJECTED,
        adminNote: adminNote?.trim() || null,
        reviewedById: adminId,
        reviewedAt: new Date(),
      },
    });
  }

  async unmergeListing(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { id: true, mergeGroupId: true },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (!listing.mergeGroupId) {
      throw new BadRequestException('این آگهی در هیچ گروهی نیست');
    }

    const groupId = listing.mergeGroupId;
    await this.prisma.listing.update({
      where: { id: listingId },
      data: { mergeGroupId: null },
    });

    const remaining = await this.prisma.listing.count({
      where: { mergeGroupId: groupId },
    });
    if (remaining <= 1) {
      // اگر فقط یک عضو مانده، گروه را خالی و حذف کن
      if (remaining === 1) {
        await this.prisma.listing.updateMany({
          where: { mergeGroupId: groupId },
          data: { mergeGroupId: null },
        });
      }
      await this.prisma.listingMergeGroup
        .delete({ where: { id: groupId } })
        .catch(() => undefined);
    }

    return { ok: true };
  }
}
