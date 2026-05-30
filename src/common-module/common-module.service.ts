import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { ListingStatus, LocationType, NotificationType } from '@prisma/client';
import { PrismaService } from '../infrastructure/prisma/prisma.service';
import { NotificationService } from '../modules/notification/notification.service';
import { findLocationBySlug } from './location-slug.util';
import { parseListingTypesEnabledFromMap } from '../common/system-settings/listing-type-enabled';
import { filterCategoriesVisibleOnSite, isCategoryVisibleOnSite } from '../common/category-visibility.util';
import {
  buildPwaManifestDocument,
  getFrontendAppOrigin,
  getPwaAppIconFilename,
  getPwaFaviconFilename,
  getPwaAppName,
  getPwaAppShortName,
  isRasterImageFilename,
  mimeForBrandFilename,
  resolveBrandLogoAbsolutePath,
} from '../common/pwa-brand-icon.util';

@Injectable()
export class CommonService {
  constructor(
    private prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // دریافت لیست استان‌ها (به ترتیب حروف الفبا)
  async getProvinces() {
    return this.prisma.location.findMany({
      where: { type: 'PROVINCE' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  // دریافت شهرهای یک استان خاص
  async getCities(provinceId: string) {
    return this.prisma.location.findMany({
      where: { parentId: provinceId, type: 'CITY' },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    });
  }

  // دریافت دسته‌بندی‌ها — درخت کامل (هر عمق) + تعداد آگهی تأییدشده در هر شاخه
  async getCategories() {
    const rows = await this.prisma.category.findMany({
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        icon: true,
        parentId: true,
        isActive: true,
      },
    });
    const visible = filterCategoriesVisibleOnSite(rows);
    const rollup = await this.getApprovedListingRollupCounts();
    const tree = this.buildCategoryTree(visible, null);
    return this.attachListingCounts(tree, rollup);
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

  private async findCategoryBySlug(slug: string) {
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
        parent: { select: { id: true, title: true, slug: true, isActive: true } },
        children: {
          orderBy: { title: 'asc' },
          select: { id: true, title: true, slug: true, icon: true, isActive: true },
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

  private categoryIdsForLanding(category: {
    id: string;
    children: Array<{ id: string }>;
  }): string[] {
    const childIds = category.children.map((c) => c.id);
    return [category.id, ...childIds];
  }

  private listingWhereForCategoryLocation(
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

  private async buildCategoryLandingPayload(
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
    const categoryIds = this.categoryIdsForLanding(category);
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

    const recentListings = await this.prisma.listing.findMany({
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

    const topLocations = location
      ? []
      : await this.fetchTopLocationsForCategory(categoryIds);

    const locationLabel = location
      ? location.type === LocationType.PROVINCE
        ? `استان ${location.name}`
        : location.name
      : null;

    const seoTitle = this.buildCategoryLocationSeoTitle(
      category,
      locationLabel,
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
      },
    };
  }

  private buildCategoryLocationSeoTitle(
    category: {
      title: string;
      parent: { title: string } | null;
    },
    locationLabel: string | null,
  ): string {
    if (locationLabel) {
      return category.parent
        ? `خرید و فروش ${category.title} در ${locationLabel} | ${category.parent.title} | طبقه`
        : `خرید و فروش ${category.title} در ${locationLabel} | طبقه`;
    }
    return category.parent
      ? `خرید و فروش ${category.title} | ${category.parent.title} | طبقه`
      : `خرید و فروش ${category.title} | طبقه`;
  }

  private buildCategoryLocationSeoDescription(
    category: {
      title: string;
      parent: { title: string } | null;
    },
    locationLabel: string | null,
    listingCount: number,
  ): string {
    if (locationLabel) {
      return category.parent
        ? `آگهی‌های خرید، فروش، مزایده و معاوضه ${category.title} در ${locationLabel} (دسته ${category.parent.title}) — ${listingCount} آگهی فعال در طبقه.`
        : `آگهی‌های خرید، فروش، مزایده و معاوضه ${category.title} در ${locationLabel} — ${listingCount} آگهی فعال در طبقه.`;
    }
    return category.parent
      ? `آگهی‌های خرید، فروش، مزایده و معاوضه ${category.title} در دسته ${category.parent.title} — ${listingCount} آگهی فعال در بازار امن طبقه.`
      : `آگهی‌های خرید، فروش، مزایده و معاوضه ${category.title} — ${listingCount} آگهی فعال در بازار امن طبقه.`;
  }

  private async fetchTopLocationsForCategory(categoryIds: string[]) {
    const rows = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        deletedAt: null,
        categoryId: { in: categoryIds },
      },
      select: { cityId: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.cityId) continue;
      counts.set(row.cityId, (counts.get(row.cityId) ?? 0) + 1);
    }

    const topCityIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([id]) => id);
    if (!topCityIds.length) return [];

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
        if ((node.listingCount ?? 0) > 0) {
          flat.push({
            id: node.id,
            title: node.title,
            slug: node.slug,
            parentTitle,
            listingCount: node.listingCount ?? 0,
          });
        }
        if (node.children?.length) {
          walk(node.children, node.title);
        }
      }
    };
    walk(tree, null);
    return flat.sort((a, b) => b.listingCount - a.listingCount);
  }

  private async getApprovedListingRollupCounts(): Promise<Map<string, number>> {
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
    const compute = (id: string): number => {
      if (rollup.has(id)) return rollup.get(id)!;
      let total = direct.get(id) ?? 0;
      for (const childId of childrenByParent.get(id) ?? []) {
        total += compute(childId);
      }
      rollup.set(id, total);
      return total;
    };
    for (const r of rows) compute(r.id);
    return rollup;
  }

  private attachListingCounts(
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

  private buildCategoryTree<
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
  async getPublicSiteSettings() {
    const PUBLIC_KEYS = [
      'HOMEPAGE_BANNER',
      'MEDIA_FALLBACK_LOGO',
      'USER_APP_LOGO',
      'USER_APP_LOGO_LIGHT',
      'USER_APP_LOGO_DARK',
      'CRITICAL_ALERT_ENABLED',
      'CRITICAL_ALERT_LABEL',
      'CRITICAL_ALERT_TEXT',
      'CRITICAL_ALERT_BG_COLOR',
      'CRITICAL_ALERT_TEXT_COLOR',
      'SUPPORT_PHONE',
      'SUPPORT_EMAIL',
      'PLATFORM_ADDRESS',
      'PLATFORM_ADDRESSES',
      'PLATFORM_LATITUDE',
      'PLATFORM_LONGITUDE',
      'VERIFICATION_FEE',
      'SHIPPING_COST',
      'BANK_CARD_NUMBER',
      'BANK_ACCOUNT_HOLDER',
      'BANK_SHABA',
      'MANUAL_CARD_TRANSFER_MAX',
      'FOOTER_SOCIAL_LINKS',
      'BUYER_CONFIRM_DEADLINE_MINUTES',
      'BUYER_CONFIRM_DEADLINE_DAYS',
      'LISTING_TYPE_DIRECT_ENABLED',
      'LISTING_TYPE_EXCHANGE_ENABLED',
      'LISTING_TYPE_AUCTION_ENABLED',
    ];

    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: PUBLIC_KEYS } },
      select: { key: true, value: true },
    });

    const map: Record<string, string> = {};
    for (const key of PUBLIC_KEYS) map[key] = '';
    for (const row of rows) map[row.key] = row.value;

    let platformAddresses: Array<{
      id: string;
      label: string;
      address: string;
      postalCode: string;
    }> = [];
    try {
      const parsed = JSON.parse(map.PLATFORM_ADDRESSES || '[]');
      if (Array.isArray(parsed)) {
        platformAddresses = parsed
          .map((x, idx) => ({
            id:
              typeof x?.id === 'string' && x.id.trim()
                ? x.id.trim()
                : `addr-${idx + 1}`,
            label: typeof x?.label === 'string' ? x.label.trim() : '',
            address: typeof x?.address === 'string' ? x.address.trim() : '',
            postalCode:
              typeof x?.postalCode === 'string'
                ? x.postalCode.replace(/[^\d]/g, '')
                : '',
          }))
          .filter((x) => x.address);
      }
    } catch {
      platformAddresses = [];
    }

    const primaryAddress =
      map.PLATFORM_ADDRESS || platformAddresses[0]?.address || null;

    const defaultBuyerConfirmMinutes = 4 * 24 * 60;
    let buyerConfirmDeadlineMinutes = defaultBuyerConfirmMinutes;
    const buyerMinutesRaw = map.BUYER_CONFIRM_DEADLINE_MINUTES?.trim();
    const buyerDaysRaw = map.BUYER_CONFIRM_DEADLINE_DAYS?.trim();
    if (buyerMinutesRaw) {
      const parsed = Number(buyerMinutesRaw.replace(/[^\d]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        buyerConfirmDeadlineMinutes = parsed;
      }
    } else if (buyerDaysRaw) {
      const parsed = Number(buyerDaysRaw.replace(/[^\d]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        buyerConfirmDeadlineMinutes = parsed * 24 * 60;
      }
    }

    const allowedSocial = new Set([
      'instagram',
      'telegram',
      'whatsapp',
      'youtube',
      'linkedin',
      'twitter',
      'aparat',
      'eitaa',
      'rubika',
      'github',
      'website',
    ]);
    const footerSocialLinks: Array<{ network: string; url: string }> = [];
    try {
      const parsed = JSON.parse(map.FOOTER_SOCIAL_LINKS || '[]');
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (!item || typeof item !== 'object') continue;
          const network = String((item as { network?: string }).network ?? '')
            .trim()
            .toLowerCase();
          const urlRaw = String((item as { url?: string }).url ?? '').trim();
          if (!allowedSocial.has(network) || !urlRaw) continue;
          let url = urlRaw;
          if (!/^https?:\/\//i.test(url)) {
            url = url.startsWith('//')
              ? `https:${url}`
              : `https://${url.replace(/^\/+/, '')}`;
          }
          if (/^https?:\/\//i.test(url))
            footerSocialLinks.push({ network, url });
        }
      }
    } catch {
      // ignore
    }

    const legacyUserLogo = map.USER_APP_LOGO?.trim() || null;
    const rawLight = map.USER_APP_LOGO_LIGHT?.trim() || null;
    const rawDark = map.USER_APP_LOGO_DARK?.trim() || null;
    const userAppLogoLight = rawLight || legacyUserLogo;
    const userAppLogoDark = rawDark || legacyUserLogo;

    return {
      homepageBanner: map.HOMEPAGE_BANNER || null,
      mediaFallbackLogo: map.MEDIA_FALLBACK_LOGO || null,
      /** @deprecated برای سازگاری؛ همان لوگوی تم روشن یا قدیمی */
      userAppLogo: userAppLogoLight,
      userAppLogoLight,
      userAppLogoDark,
      criticalAlertEnabled: map.CRITICAL_ALERT_ENABLED === 'true',
      criticalAlertLabel: map.CRITICAL_ALERT_LABEL || null,
      criticalAlertText: map.CRITICAL_ALERT_TEXT || null,
      criticalAlertBgColor: map.CRITICAL_ALERT_BG_COLOR || '#ef4444',
      criticalAlertTextColor: map.CRITICAL_ALERT_TEXT_COLOR || '#ffffff',
      supportPhone: map.SUPPORT_PHONE || null,
      supportEmail: map.SUPPORT_EMAIL || null,
      platformAddress: primaryAddress,
      platformAddresses,
      platformLatitude: map.PLATFORM_LATITUDE
        ? Number(map.PLATFORM_LATITUDE)
        : null,
      platformLongitude: map.PLATFORM_LONGITUDE
        ? Number(map.PLATFORM_LONGITUDE)
        : null,
      verificationFee: map.VERIFICATION_FEE ? Number(map.VERIFICATION_FEE) : 0,
      shippingCost: map.SHIPPING_COST ? Number(map.SHIPPING_COST) : 0,
      bankCardNumber: map.BANK_CARD_NUMBER || null,
      bankAccountHolder: map.BANK_ACCOUNT_HOLDER || null,
      bankShaba: map.BANK_SHABA || null,
      manualCardTransferMax: map.MANUAL_CARD_TRANSFER_MAX
        ? Number(map.MANUAL_CARD_TRANSFER_MAX)
        : 10000000,
      buyerConfirmDeadlineMinutes,
      footerSocialLinks,
      listingTypesEnabled: parseListingTypesEnabledFromMap(map),
    };
  }

  /** متن قوانین و مقررات برای نمایش عمومی */
  async getTermsAndConditions() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'TERMS_CONDITIONS' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value ?? '',
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** متن درباره ما برای نمایش عمومی */
  async getAboutUs() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'ABOUT_US' },
      select: { value: true, updatedAt: true },
    });
    return {
      content: row?.value ?? '',
      updatedAt: row?.updatedAt ?? null,
    };
  }

  /** سوالات متداول (برای نمایش عمومی) */
  async getFaqs() {
    return this.prisma.faq.findMany({
      where: { isActive: true },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        question: true,
        answer: true,
        category: true,
        order: true,
      },
    });
  }

  async getIntroduction() {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SYSTEM_INTRO_CONTENT' },
      select: { value: true, updatedAt: true },
    });
    return { content: row?.value ?? '', updatedAt: row?.updatedAt ?? null };
  }

  async getBlogPosts() {
    const rows = await this.prisma.blogPost.findMany({
      where: { isPublished: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((x) => ({
      id: x.id,
      slug: x.slug,
      title: x.title,
      description: x.description,
      excerpt: x.description,
      content: x.description,
      image: x.image ?? null,
      outline: x.outline ?? null,
      note: x.note ?? null,
      createdAt: x.createdAt,
      updatedAt: x.updatedAt,
    }));
  }

  async getBlogPostBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, isPublished: true },
    });
    if (!post) return null;
    return {
      id: post.id,
      slug: post.slug,
      title: post.title,
      description: post.description,
      excerpt: post.description,
      content: post.description,
      image: post.image ?? null,
      outline: post.outline ?? null,
      note: post.note ?? null,
      createdAt: post.createdAt,
      updatedAt: post.updatedAt,
    };
  }

  private toLatinDigits(text: string): string {
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    const arabic = '٠١٢٣٤٥٦٧٨٩';
    return text.replace(/[۰-۹٠-٩]/g, (ch) => {
      const pi = persian.indexOf(ch);
      if (pi >= 0) return String(pi);
      const ai = arabic.indexOf(ch);
      return ai >= 0 ? String(ai) : ch;
    });
  }

  private normalizeIranMobile(input: string): string | null {
    let digits = this.toLatinDigits(String(input ?? '').trim()).replace(/\D/g, '');
    if (digits.startsWith('98') && digits.length === 12) {
      digits = `0${digits.slice(2)}`;
    }
    if (digits.startsWith('9') && digits.length === 10) {
      digits = `0${digits}`;
    }
    if (!/^09\d{9}$/.test(digits)) return null;
    return digits;
  }

  async subscribeCustomerClub(rawContact: string) {
    const contact = String(rawContact ?? '').trim();
    if (!contact) {
      throw new BadRequestException('لطفاً ایمیل یا شماره موبایل را وارد کنید');
    }

    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phone = this.normalizeIranMobile(contact);
    const email = !phone && emailRe.test(contact) ? contact.toLowerCase() : null;

    if (!phone && !email) {
      if (/@/.test(contact) || /[a-zA-Z]/.test(contact)) {
        throw new BadRequestException('فرمت ایمیل صحیح نیست');
      }
      throw new BadRequestException(
        'شماره موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۳۴۵۶۷۸۹)',
      );
    }

    const key = phone
      ? `CUSTOMER_CLUB_PHONE_${phone}`
      : `CUSTOMER_CLUB_EMAIL_${email}`;

    const existing = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { key: true },
    });
    if (existing) {
      throw new ConflictException(
        phone
          ? 'این شماره موبایل قبلاً در کلوپ مشتریان ثبت شده است'
          : 'این ایمیل قبلاً در کلوپ مشتریان ثبت شده است',
      );
    }

    await this.prisma.systemSetting.create({
      data: {
        key,
        value: JSON.stringify({
          phone: phone ?? null,
          email: email ?? null,
          createdAt: new Date().toISOString(),
        }),
        description: 'Customer club subscription',
      },
    });

    return { ok: true };
  }

  async submitContactMessage(payload: {
    name: string;
    phone: string;
    email?: string;
    subject: string;
    message: string;
  }) {
    const key = `CONTACT_MESSAGE_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const value = JSON.stringify({
      ...payload,
      createdAt: new Date().toISOString(),
    });
    await this.prisma.systemSetting.create({
      data: {
        key,
        value,
        description: 'Public contact form submission',
      },
    });
    void this.notifications
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_CONTACT_MESSAGE,
        title: 'پیام تماس با ما',
        message: `${payload.name} — ${payload.subject}`,
        meta: {
          contactKey: key,
          name: payload.name,
          phone: payload.phone,
          email: payload.email ?? '',
          subject: payload.subject,
        },
      })
      .catch(() => undefined);
    return { ok: true };
  }

  async buildPwaManifest(): Promise<Record<string, unknown>> {
    const name = await getPwaAppName(this.prisma);
    const shortName = await getPwaAppShortName(this.prisma);
    return buildPwaManifestDocument(name, shortName, true);
  }

  async resolvePwaIconAsset(): Promise<{ path: string; mime: string } | null> {
    const filename = await getPwaAppIconFilename(this.prisma);
    if (!filename) return null;
    const path = resolveBrandLogoAbsolutePath(filename);
    if (!path) return null;
    return { path, mime: mimeForBrandFilename(filename) };
  }

  async resolveFaviconAsset(): Promise<{ path: string; mime: string } | null> {
    const filename = await getPwaFaviconFilename(this.prisma);
    if (!filename) return null;
    const path = resolveBrandLogoAbsolutePath(filename);
    if (!path) return null;
    return { path, mime: mimeForBrandFilename(filename) };
  }

  async getPushIconMeta(): Promise<{ url: string; raster: boolean }> {
    const origin = getFrontendAppOrigin();
    return {
      url: `${origin}/pwa/icon-512.png`,
      raster: true,
    };
  }
}
