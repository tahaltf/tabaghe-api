import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';

import { ListingStatus, LocationType } from '@prisma/client';
import { findLocationBySlug } from '../location-slug.util';
import { filterCategoriesVisibleOnSite, isCategoryVisibleOnSite } from '../../common/category-visibility.util';
import { CategoryTreeCacheService } from '../../common/category/category-tree-cache.service';

@Injectable()
export class CommonCategoryService {
  private static readonly CACHE_TTL_SECONDS = 90;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
    private readonly categoryTree: CategoryTreeCacheService,
  ) {}

  // دریافت دسته‌بندی‌ها — درخت کامل (هر عمق) + تعداد آگهی تأییدشده در هر شاخه
  async getCategories() {
    return this.cache.getOrSet('common:categories', CommonCategoryService.CACHE_TTL_SECONDS, async () => {
      const rows = await this.prisma.category.findMany({
        orderBy: { title: 'asc' },
        select: {
          id: true,
          title: true,
          slug: true,
          icon: true,
          parentId: true,
          isActive: true,
          verificationEnabled: true,
        },
      });
      const visible = filterCategoriesVisibleOnSite(rows);
      const rollup = await this.getApprovedListingRollupCounts();
      const tree = this.buildCategoryTree(visible, null);
      return this.attachListingCounts(tree, rollup);
    });
  }

  /** فقط دسته‌های ریشه‌ای که در خود یا زیرشاخه‌شان آگهی دارند (صفحه اصلی) */
  async getHomeCategories() {
    const tree = await this.getCategories();
    return tree.filter((c) => (c.listingCount ?? 0) > 0);
  }

  /** صفحه لندینگ SEO دسته‌بندی */
  async getCategoryLandingBySlug(slug: string) {
    const category = await this.findCategoryBySlug(slug);
    if (!category) return null;
    return this.buildCategoryLandingPayload(category, null);
  }

  /** صفحه لندینگ SEO دسته + شهر یا استان */
  async getCategoryLocationLandingBySlugs(
    categorySlug: string,
    locationSlug: string,
  ) {
    const category = await this.findCategoryBySlug(categorySlug);
    if (!category) return null;

    const location = await findLocationBySlug(this.prisma, locationSlug);
    if (!location) return null;

    return this.buildCategoryLandingPayload(category, location);
  }

  async findCategoryBySlug(slug: string) {
    const normalized = String(slug ?? '').trim().toLowerCase();
    if (!normalized) return null;

    const category = await this.prisma.category.findFirst({
      where: { slug: normalized },
      select: {
        id: true,
        title: true,
        slug: true,
        icon: true,
        parentId: true,
        isActive: true,
        verificationEnabled: true,
        parent: { select: { id: true, title: true, slug: true, isActive: true } },
        children: {
          orderBy: { title: 'asc' },
          select: {
            id: true,
            title: true,
            slug: true,
            icon: true,
            isActive: true,
            verificationEnabled: true,
          },
        },
      },
    });
    if (!category) return null;

    const visibilityRows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const byId = new Map(visibilityRows.map((r) => [r.id, r]));
    if (!isCategoryVisibleOnSite(category.id, byId)) return null;

    return {
      ...category,
      children: category.children.filter((c) =>
        isCategoryVisibleOnSite(c.id, byId),
      ),
    };
  }

  async categoryIdsForLanding(categoryId: string): Promise<string[]> {
    return this.categoryTree.resolveDescendantIds(categoryId);
  }

  listingWhereForCategoryLocation(
    categoryIds: string[],
    location: {
      type: LocationType;
      id: string;
    } | null,
  ) {
    const base = {
      status: ListingStatus.APPROVED,
      deletedAt: null,
      categoryId: { in: categoryIds },
    } as const;

    if (!location) return base;
    if (location.type === LocationType.CITY) {
      return { ...base, cityId: location.id };
    }
    return { ...base, provinceId: location.id };
  }

  async buildCategoryLandingPayload(
    category: {
      id: string;
      title: string;
      slug: string;
      icon: string | null;
      parent: { id: string; title: string; slug: string } | null;
      children: Array<{
        id: string;
        title: string;
        slug: string;
        icon: string | null;
      }>;
    },
    location: {
      id: string;
      name: string;
      slug: string;
      type: LocationType;
      parent?: { id: string; name: string; slug: string } | null;
    } | null,
  ) {
    const rollup = await this.getApprovedListingRollupCounts();
    const categoryIds = await this.categoryIdsForLanding(category.id);
    const listingWhere = this.listingWhereForCategoryLocation(
      categoryIds,
      location,
    );

    const listingCount = await this.prisma.listing.count({
      where: listingWhere,
    });

    const children = category.children.map((child) => ({
      ...child,
      listingCount: rollup.get(child.id) ?? 0,
    }));

    const recentListingsRaw = await this.prisma.listing.findMany({
      where: listingWhere,
      select: {
        id: true,
        title: true,
        type: true,
        thumbnail: true,
        createdAt: true,
        category: { select: { id: true, title: true, slug: true } },
        city: { select: { id: true, name: true, slug: true } },
        direct: { select: { price: true } },
        auction: {
          select: {
            basePrice: true,
            highestBidAmount: true,
            endDatetime: true,
            status: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 24,
    });
    const recentListings = this.serializeRecentListings(recentListingsRaw);

    const topLocations = location
      ? []
      : await this.fetchTopLocationsForCategory(categoryIds, 30);

    const locationLabel = location
      ? location.type === LocationType.PROVINCE
        ? location.name
        : location.name
      : null;

    const seoTitle = this.buildCategoryLocationSeoTitle(
      category,
      locationLabel,
      location?.type ?? null,
    );
    const seoDescription = this.buildCategoryLocationSeoDescription(
      category,
      locationLabel,
      listingCount,
    );
    const canonicalPath = location
      ? `/category/${category.slug}/${location.slug}`
      : `/category/${category.slug}`;

    return {
      category: {
        id: category.id,
        title: category.title,
        slug: category.slug,
        icon: category.icon,
        parent: category.parent,
        listingCount,
      },
      location: location
        ? {
            id: location.id,
            name: location.name,
            slug: location.slug,
            type: location.type,
            province: location.parent ?? null,
          }
        : null,
      children,
      recentListings,
      topLocations,
      seo: {
        title: seoTitle,
        description: seoDescription,
        canonicalPath,
        intro: this.buildCategorySeoIntro(category, locationLabel, location?.type ?? null),
      },
    };
  }

  buildCategoryLocationSeoTitle(
    category: {
      title: string;
      parent: { title: string } | null;
    },
    locationLabel: string | null,
    locationType?: LocationType | null,
  ): string {
    if (locationLabel) {
      const inLabel =
        locationType === LocationType.PROVINCE
          ? `استان ${locationLabel.replace(/^استان\s+/, '')}`
          : locationLabel;
      return `خرید و فروش ${category.title} در ${inLabel} | طبقه`;
    }
    return `خرید و فروش ${category.title} | طبقه`;
  }

  buildCategoryLocationSeoDescription(
    category: {
      title: string;
      parent: { title: string } | null;
    },
    locationLabel: string | null,
    listingCount: number,
  ): string {
    const countSuffix =
      listingCount > 0
        ? `${listingCount} آگهی فعال در طبقه.`
        : 'ثبت آگهی رایگان در بازار امن طبقه.';

    if (locationLabel) {
      return category.parent
        ? `خرید، فروش، مزایده و معاوضه ${category.title} در ${locationLabel} (دسته ${category.parent.title}) — ${countSuffix}`
        : `خرید، فروش، مزایده و معاوضه ${category.title} در ${locationLabel} — ${countSuffix}`;
    }
    return category.parent
      ? `خرید، فروش، مزایده و معاوضه ${category.title} در دسته ${category.parent.title} — ${countSuffix}`
      : `خرید، فروش، مزایده و معاوضه ${category.title} — ${countSuffix}`;
  }

  buildCategorySeoIntro(
    category: { title: string; parent: { title: string } | null },
    locationLabel: string | null,
    locationType: LocationType | null,
  ): string {
    if (locationLabel) {
      const place =
        locationType === LocationType.PROVINCE
          ? `استان ${locationLabel.replace(/^استان\s+/, '')}`
          : locationLabel;
      return `صفحه اختصاصی آگهی ${category.title} در ${place}؛ خرید، فروش، مزایده و معاوضه با امنیت میانجی در طبقه.`;
    }
    if (category.parent) {
      return `در دسته ${category.parent.title}، آگهی‌های ${category.title} را ببینید یا اولین آگهی خود را در این حوزه ثبت کنید.`;
    }
    return `صفحه خرید و فروش ${category.title} در بازار امن طبقه؛ مزایده، معاوضه و خرید مستقیم با کارشناسی و تسویه امن.`;
  }

  private serializeRecentListings(
    items: Array<{
      id: string;
      title: string;
      type: string;
      thumbnail: string | null;
      createdAt: Date;
      category: { id: string; title: string; slug: string };
      city: { id: string; name: string; slug: string } | null;
      direct: { price: unknown } | null;
      auction: {
        basePrice: unknown;
        highestBidAmount: unknown;
        endDatetime: Date;
        status: string;
      } | null;
    }>,
  ) {
    return items.map((item) => ({
      id: item.id,
      title: item.title,
      type: item.type,
      thumbnail: item.thumbnail,
      createdAt: item.createdAt,
      category: item.category,
      city: item.city,
      direct: item.direct
        ? { price: Number(item.direct.price) }
        : null,
      auction: item.auction
        ? {
            basePrice: Number(item.auction.basePrice),
            highestBidAmount:
              item.auction.highestBidAmount != null
                ? Number(item.auction.highestBidAmount)
                : null,
            endDatetime: item.auction.endDatetime,
            status: item.auction.status,
          }
        : null,
    }));
  }

  async fetchTopLocationsForCategory(categoryIds: string[], limit = 12) {
    const grouped = await this.prisma.listing.groupBy({
      by: ['cityId'],
      where: {
        status: ListingStatus.APPROVED,
        deletedAt: null,
        categoryId: { in: categoryIds },
      },
      _count: { _all: true },
    });

    const safeLimit = Math.min(30, Math.max(1, limit));
    const topCityIds = grouped
      .filter((row) => row.cityId)
      .sort((a, b) => b._count._all - a._count._all)
      .slice(0, safeLimit)
      .map((row) => row.cityId as string);
    if (!topCityIds.length) return [];

    const counts = new Map(
      grouped.map((row) => [row.cityId as string, row._count._all]),
    );

    const cities = await this.prisma.location.findMany({
      where: { id: { in: topCityIds }, type: LocationType.CITY },
      select: {
        id: true,
        name: true,
        slug: true,
        parent: { select: { name: true } },
      },
    });
    const cityById = new Map(cities.map((c) => [c.id, c]));

    return topCityIds
      .map((cityId) => {
        const city = cityById.get(cityId);
        if (!city?.slug) return null;
        return {
          id: city.id,
          name: city.name,
          slug: city.slug,
          provinceName: city.parent?.name ?? null,
          listingCount: counts.get(cityId) ?? 0,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null);
  }

  /** فهرست دسته‌ها برای صفحه ایندکس SEO */
  async getCategorySeoIndex() {
    const tree = await this.getCategories();
    const flat: Array<{
      id: string;
      title: string;
      slug: string;
      parentTitle: string | null;
      listingCount: number;
    }> = [];

    const walk = (
      nodes: Array<{
        id: string;
        title: string;
        slug: string;
        listingCount?: number;
        children?: typeof nodes;
      }>,
      parentTitle: string | null,
    ) => {
      for (const node of nodes) {
        flat.push({
          id: node.id,
          title: node.title,
          slug: node.slug,
          parentTitle,
          listingCount: node.listingCount ?? 0,
        });
        if (node.children?.length) {
          walk(node.children, node.title);
        }
      }
    };
    walk(tree, null);
    return flat.sort(
      (a, b) => b.listingCount - a.listingCount || a.title.localeCompare(b.title, 'fa'),
    );
  }

  async getApprovedListingRollupCounts(): Promise<Map<string, number>> {
    const grouped = await this.prisma.listing.groupBy({
      by: ['categoryId'],
      where: { status: ListingStatus.APPROVED },
      _count: { _all: true },
    });
    const direct = new Map(grouped.map((g) => [g.categoryId, g._count._all]));
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string | null, string[]>();
    for (const r of rows) {
      const key = r.parentId;
      const list = childrenByParent.get(key) ?? [];
      list.push(r.id);
      childrenByParent.set(key, list);
    }
    const rollup = new Map<string, number>();
    const compute = (id: string, visiting = new Set<string>()): number => {
      if (rollup.has(id)) return rollup.get(id)!;
      if (visiting.has(id)) return direct.get(id) ?? 0;
      visiting.add(id);
      let total = direct.get(id) ?? 0;
      for (const childId of childrenByParent.get(id) ?? []) {
        total += compute(childId, visiting);
      }
      visiting.delete(id);
      rollup.set(id, total);
      return total;
    };
    for (const r of rows) compute(r.id);
    return rollup;
  }

  attachListingCounts(
    nodes: any[],
    rollup: Map<string, number>,
  ): any[] {
    return nodes.map((node) => {
      const rawChildren = Array.isArray(node.children) ? node.children : [];
      const children = rawChildren.length
        ? this.attachListingCounts(rawChildren, rollup)
        : undefined;
      return {
        ...node,
        listingCount: rollup.get(node.id) ?? 0,
        ...(children?.length ? { children } : {}),
      };
    });
  }

  buildCategoryTree<
    T extends {
      id: string;
      title: string;
      slug: string;
      icon: string | null;
      parentId: string | null;
    },
  >(
    rows: T[],
    parentId: string | null,
  ): Array<T & { children?: Array<T & { children?: unknown[] }> }> {
    return rows
      .filter((r) => r.parentId === parentId)
      .map((row) => {
        const children = this.buildCategoryTree(rows, row.id);
        return {
          ...row,
          ...(children.length ? { children } : {}),
        };
      });
  }

  // دسته‌بندی‌های مجاز برای تعمیرات (قابل تنظیم توسط ادمین)
  async getRepairCategories() {
    const allowedSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'REPAIR_ALLOWED_CATEGORY_IDS' },
      select: { value: true },
    });

    const all = await this.getCategories();
    if (!allowedSetting) return all;
    if (!allowedSetting.value?.trim()) return [];

    let allowedIds: string[] = [];
    try {
      const parsed = JSON.parse(allowedSetting.value);
      if (Array.isArray(parsed)) {
        allowedIds = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      allowedIds = [];
    }
    if (!allowedIds.length) return [];

    const set = new Set(allowedIds);
    return all
      .map((root) => {
        const selfAllowed = set.has(root.id);
        const children = (root.children ?? []).filter((c) => set.has(c.id));
        if (!selfAllowed && !children.length) return null;
        return {
          ...root,
          children,
        };
      })
      .filter(Boolean);
  }

  // تنظیمات عمومی سایت که برای کاربران عادی هم باید در دسترس باشه
}
