import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListingStatus, LocationType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { isCategoryVisibleOnSite } from '../../common/category-visibility.util';

export interface SitemapUrlEntry {
  loc: string;
  lastmod?: string;
  changefreq?:
    | 'always'
    | 'hourly'
    | 'daily'
    | 'weekly'
    | 'monthly'
    | 'yearly'
    | 'never';
  priority?: number;
}

export type SitemapPartId =
  | 'static'
  | 'categories'
  | 'category-locations'
  | 'locations'
  | 'listings'
  | 'blog';

const SITEMAP_PARTS: SitemapPartId[] = [
  'static',
  'categories',
  'category-locations',
  'locations',
  'listings',
  'blog',
];

const MAX_URLS_PER_SITEMAP = 45_000;

@Injectable()
export class SitemapService {
  private readonly siteOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    const configured = (
      config.get<string>('FRONTEND_APP_URL') ?? 'https://tabagheh.com'
    ).trim();
    this.siteOrigin = configured.replace(/\/+$/, '');
  }

  getSiteOrigin(): string {
    return this.siteOrigin;
  }

  listSitemapPartIds(): SitemapPartId[] {
    return [...SITEMAP_PARTS];
  }

  async buildSitemapIndexXml(): Promise<string> {
    const now = new Date().toISOString();
    const nodes = SITEMAP_PARTS.map((part) => {
      const loc = `${this.siteOrigin}/sitemap-${part}.xml`;
      return `  <sitemap>\n    <loc>${this.escapeXml(loc)}</loc>\n    <lastmod>${this.escapeXml(now)}</lastmod>\n  </sitemap>`;
    }).join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      nodes,
      '</sitemapindex>',
    ].join('\n');
  }

  async buildPartXml(part: SitemapPartId): Promise<string> {
    const entries = await this.buildPartEntries(part);
    return this.buildSitemapXml(entries);
  }

  /** @deprecated Use buildSitemapIndexXml + buildPartXml */
  async buildUrlEntries(): Promise<SitemapUrlEntry[]> {
    const chunks = await Promise.all(
      SITEMAP_PARTS.map((part) => this.buildPartEntries(part)),
    );
    return chunks.flat();
  }

  async buildPartEntries(part: SitemapPartId): Promise<SitemapUrlEntry[]> {
    switch (part) {
      case 'static':
        return this.getStaticPages();
      case 'categories':
        return this.fetchCategoryEntries();
      case 'category-locations':
        return this.fetchAllCategoryLocationEntries();
      case 'locations':
        return this.fetchAllLocationHubEntries();
      case 'listings':
        return this.fetchListingEntries();
      case 'blog':
        return this.fetchBlogEntries();
      default:
        return [];
    }
  }

  buildSitemapXml(entries: SitemapUrlEntry[]): string {
    const urlNodes = entries
      .map((entry) => {
        const parts = [
          '  <url>',
          `    <loc>${this.escapeXml(entry.loc)}</loc>`,
        ];
        if (entry.lastmod) {
          parts.push(`    <lastmod>${this.escapeXml(entry.lastmod)}</lastmod>`);
        }
        if (entry.changefreq) {
          parts.push(`    <changefreq>${entry.changefreq}</changefreq>`);
        }
        if (entry.priority != null) {
          parts.push(`    <priority>${entry.priority.toFixed(1)}</priority>`);
        }
        parts.push('  </url>');
        return parts.join('\n');
      })
      .join('\n');

    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      urlNodes,
      '</urlset>',
    ].join('\n');
  }

  buildRobotsTxt(): string {
    const sitemapUrl = `${this.siteOrigin}/sitemap.xml`;
    return [
      'User-agent: *',
      'Allow: /',
      'Disallow: /dashboard/',
      'Disallow: /admin/',
      'Disallow: /auth',
      'Disallow: /admin-auth',
      'Disallow: /complete-profile',
      'Disallow: /checkout/',
      'Disallow: /orders/',
      'Disallow: /payment-result',
      '',
      `Sitemap: ${sitemapUrl}`,
      '',
    ].join('\n');
  }

  private getStaticPages(): SitemapUrlEntry[] {
    const now = new Date().toISOString();
    const pages: Array<{
      path: string;
      priority: number;
      changefreq: SitemapUrlEntry['changefreq'];
    }> = [
      { path: '/', priority: 1.0, changefreq: 'daily' },
      { path: '/listings', priority: 0.9, changefreq: 'hourly' },
      { path: '/categories', priority: 0.85, changefreq: 'weekly' },
      { path: '/locations', priority: 0.82, changefreq: 'weekly' },
      { path: '/blog', priority: 0.8, changefreq: 'daily' },
      { path: '/plans', priority: 0.7, changefreq: 'weekly' },
      { path: '/about', priority: 0.5, changefreq: 'monthly' },
      { path: '/introduction', priority: 0.5, changefreq: 'monthly' },
      { path: '/contact', priority: 0.5, changefreq: 'monthly' },
      { path: '/faq', priority: 0.5, changefreq: 'monthly' },
      { path: '/terms', priority: 0.4, changefreq: 'yearly' },
    ];

    return pages.map((page) => ({
      loc: `${this.siteOrigin}${page.path}`,
      lastmod: now,
      changefreq: page.changefreq,
      priority: page.priority,
    }));
  }

  private async fetchAllLocationHubEntries(): Promise<SitemapUrlEntry[]> {
    const locations = await this.prisma.location.findMany({
      select: { id: true, slug: true, type: true, createdAt: true },
      orderBy: { name: 'asc' },
    });

    const listingAgg = await this.prisma.listing.findMany({
      where: { status: ListingStatus.APPROVED, deletedAt: null },
      select: {
        updatedAt: true,
        cityId: true,
        provinceId: true,
      },
    });

    const cityLastmod = new Map<string, Date>();
    const provinceLastmod = new Map<string, Date>();
    for (const row of listingAgg) {
      if (row.cityId) {
        const prev = cityLastmod.get(row.cityId);
        if (!prev || row.updatedAt > prev) {
          cityLastmod.set(row.cityId, row.updatedAt);
        }
      }
      if (row.provinceId) {
        const prev = provinceLastmod.get(row.provinceId);
        if (!prev || row.updatedAt > prev) {
          provinceLastmod.set(row.provinceId, row.updatedAt);
        }
      }
    }

    const entries: SitemapUrlEntry[] = [];
    for (const loc of locations) {
      const fallback = loc.createdAt.toISOString();
      if (loc.type === LocationType.CITY) {
        entries.push({
          loc: `${this.siteOrigin}/listings/city/${loc.slug}`,
          lastmod: (cityLastmod.get(loc.id) ?? loc.createdAt).toISOString(),
          changefreq: 'daily',
          priority: 0.68,
        });
      } else if (loc.type === LocationType.PROVINCE) {
        entries.push({
          loc: `${this.siteOrigin}/listings/province/${loc.slug}`,
          lastmod: (provinceLastmod.get(loc.id) ?? loc.createdAt).toISOString(),
          changefreq: 'daily',
          priority: 0.66,
        });
      }
    }

    return entries;
  }

  private async fetchAllCategoryLocationEntries(): Promise<SitemapUrlEntry[]> {
    const [categories, locations] = await Promise.all([
      this.prisma.category.findMany({
        select: { slug: true, id: true, parentId: true, isActive: true, createdAt: true },
        orderBy: { title: 'asc' },
      }),
      this.prisma.location.findMany({
        select: { slug: true, type: true, createdAt: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const categoryById = new Map(categories.map((r) => [r.id, r]));
    const visibleCategories = categories.filter((c) =>
      isCategoryVisibleOnSite(c.id, categoryById),
    );

    const entries: SitemapUrlEntry[] = [];
    for (const cat of visibleCategories) {
      const catLastmod = cat.createdAt.toISOString();
      for (const loc of locations) {
        entries.push({
          loc: `${this.siteOrigin}/category/${cat.slug}/${loc.slug}`,
          lastmod: catLastmod,
          changefreq: 'weekly',
          priority: loc.type === LocationType.CITY ? 0.72 : 0.7,
        });
        if (entries.length >= MAX_URLS_PER_SITEMAP) {
          return entries;
        }
      }
    }
    return entries;
  }

  private async fetchCategoryEntries(): Promise<SitemapUrlEntry[]> {
    const allCategories = await this.prisma.category.findMany({
      select: {
        slug: true,
        id: true,
        parentId: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { title: 'asc' },
    });
    const categoryById = new Map(allCategories.map((r) => [r.id, r]));
    const rows = allCategories.filter((c) =>
      isCategoryVisibleOnSite(c.id, categoryById),
    );

    return rows.map((c) => ({
      loc: `${this.siteOrigin}/category/${c.slug}`,
      lastmod: c.createdAt.toISOString(),
      changefreq: 'weekly' as const,
      priority: 0.75,
    }));
  }

  private async fetchListingEntries(): Promise<SitemapUrlEntry[]> {
    const listings = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        deletedAt: null,
      },
      select: {
        id: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_URLS_PER_SITEMAP,
    });

    return listings.map((listing) => ({
      loc: `${this.siteOrigin}/listing/${listing.id}`,
      lastmod: listing.updatedAt.toISOString(),
      changefreq: 'daily' as const,
      priority: 0.8,
    }));
  }

  private async fetchBlogEntries(): Promise<SitemapUrlEntry[]> {
    const posts = await this.prisma.blogPost.findMany({
      where: { isPublished: true },
      select: {
        slug: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    return posts.map((post) => ({
      loc: `${this.siteOrigin}/blog/${post.slug}`,
      lastmod: post.updatedAt.toISOString(),
      changefreq: 'weekly' as const,
      priority: 0.7,
    }));
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
