import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ListingStatus, LocationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';
import { findLocationBySlug } from '../location-slug.util';
import {
  filterCategoriesVisibleOnSite,
  isCategoryVisibleOnSite,
} from '../../common/category-visibility.util';


@Injectable()
export class CommonLocationService {
  private static readonly CACHE_TTL_SECONDS = 120;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
  ) {}

  async getProvinces() {
    return this.cache.getOrSet('common:provinces', CommonLocationService.CACHE_TTL_SECONDS, () =>
      this.prisma.location.findMany({
        where: { type: 'PROVINCE' },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, slug: true },
      }),
    );
  }

  // دریافت شهرهای یک استان خاص
  async getCities(provinceId: string) {
    return this.prisma.location.findMany({
      where: { parentId: provinceId, type: 'CITY' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  async getLocationBySlug(slug: string) {
    return findLocationBySlug(this.prisma, slug);
  }

  /** لندینگ SEO شهر یا استان */
  async getLocationLandingBySlug(slug: string) {
    const location = await findLocationBySlug(this.prisma, slug);
    if (!location) return null;

    const listingWhere =
      location.type === LocationType.CITY
        ? { status: ListingStatus.APPROVED, deletedAt: null, cityId: location.id }
        : {
            status: ListingStatus.APPROVED,
            deletedAt: null,
            provinceId: location.id,
          };

    const listingCount = await this.prisma.listing.count({ where: listingWhere });

    const grouped = await this.prisma.listing.groupBy({
      by: ['categoryId'],
      where: listingWhere,
      _count: { _all: true },
    });

    const categoryIds = grouped.map((g) => g.categoryId);
    const countByCategory = new Map(
      grouped.map((g) => [g.categoryId, g._count._all]),
    );

    const categoryRows = categoryIds.length
      ? await this.prisma.category.findMany({
          where: { id: { in: categoryIds }, isActive: true },
          select: {
            id: true,
            title: true,
            slug: true,
            icon: true,
            parentId: true,
            isActive: true,
          },
        })
      : [];

    const visibilityRows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const byId = new Map(visibilityRows.map((r) => [r.id, r]));

    const topCategories = categoryRows
      .filter((c) => isCategoryVisibleOnSite(c.id, byId))
      .map((c) => ({
        id: c.id,
        title: c.title,
        slug: c.slug,
        icon: c.icon,
        listingCount: countByCategory.get(c.id) ?? 0,
      }))
      .sort((a, b) => b.listingCount - a.listingCount || a.title.localeCompare(b.title, 'fa'))
      .slice(0, 16);

    if (!topCategories.length) {
      const fallback = filterCategoriesVisibleOnSite(
        await this.prisma.category.findMany({
          where: { parentId: null, isActive: true },
          select: {
            id: true,
            title: true,
            slug: true,
            icon: true,
            parentId: true,
            isActive: true,
          },
          orderBy: { title: 'asc' },
          take: 12,
        }),
      );
      topCategories.push(
        ...fallback.map((c) => ({
          id: c.id,
          title: c.title,
          slug: c.slug,
          icon: c.icon,
          listingCount: 0,
        })),
      );
    }

    const label =
      location.type === LocationType.PROVINCE
        ? `استان ${location.name}`
        : location.name;
    const canonicalPath =
      location.type === LocationType.CITY
        ? `/listings/city/${location.slug}`
        : `/listings/province/${location.slug}`;
    const seoTitle =
      location.type === LocationType.PROVINCE
        ? `آگهی‌های استان ${location.name} | طبقه`
        : `آگهی‌های ${location.name} | طبقه`;
    const seoDescription =
      listingCount > 0
        ? `${listingCount} آگهی فعال خرید، فروش، مزایده و معاوضه در ${label} — بازار امن طبقه.`
        : `خرید، فروش و ثبت آگهی در ${label} — بازار امن طبقه.`;

    const intro =
      location.type === LocationType.PROVINCE
        ? `در صفحه آگهی‌های استان ${location.name} می‌توانید آگهی‌های خرید مستقیم، مزایده و معاوضه را در سراسر استان ببینید یا اولین آگهی خود را ثبت کنید.`
        : `در صفحه آگهی‌های ${location.name} آگهی‌های تأییدشده این شهر را مرور کنید یا به‌عنوان اولین فروشنده در این منطقه آگهی ثبت کنید.`;

    return {
      location: {
        id: location.id,
        name: location.name,
        slug: location.slug,
        type: location.type,
        province: location.parent ?? null,
        listingCount,
      },
      topCategories,
      seo: {
        title: seoTitle,
        description: seoDescription,
        canonicalPath,
        intro,
      },
    };
  }

  /** فهرست شهرها و استان‌ها برای صفحه /locations */
  async getLocationSeoIndex() {
    const rows = await this.prisma.location.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        slug: true,
        type: true,
        parent: { select: { name: true } },
      },
    });

    const counts = await this.prisma.listing.groupBy({
      by: ['cityId'],
      where: { status: ListingStatus.APPROVED, deletedAt: null },
      _count: { _all: true },
    });
    const provinceAgg = await this.prisma.listing.groupBy({
      by: ['provinceId'],
      where: { status: ListingStatus.APPROVED, deletedAt: null },
      _count: { _all: true },
    });

    const cityCounts = new Map(
      counts.map((row) => [row.cityId as string, row._count._all]),
    );
    const provinceCounts = new Map(
      provinceAgg.map((row) => [row.provinceId as string, row._count._all]),
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      provinceName: row.parent?.name ?? null,
      listingCount:
        row.type === LocationType.CITY
          ? (cityCounts.get(row.id) ?? 0)
          : (provinceCounts.get(row.id) ?? 0),
      path:
        row.type === LocationType.CITY
          ? `/listings/city/${row.slug}`
          : `/listings/province/${row.slug}`,
    }));
  }
}
