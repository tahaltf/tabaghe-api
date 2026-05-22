import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ListingStatus } from '@prisma/client';
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

  async buildUrlEntries(): Promise<SitemapUrlEntry[]> {
    const staticPages = this.getStaticPages();
    const [listings, blogPosts, categories, categoryLocations] =
      await Promise.all([
        this.fetchListingEntries(),
        this.fetchBlogEntries(),
        this.fetchCategoryEntries(),
        this.fetchCategoryLocationEntries(),
      ]);

    return [
      ...staticPages,
      ...categories,
      ...categoryLocations,
      ...listings,
      ...blogPosts,
    ];
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

  private async fetchCategoryLocationEntries(): Promise<SitemapUrlEntry[]> {
    const visibilityRows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const categoryById = new Map(visibilityRows.map((r) => [r.id, r]));

    const rows = await this.prisma.listing.findMany({
      where: {
        status: ListingStatus.APPROVED,
        deletedAt: null,
      },
      select: {
        categoryId: true,
        cityId: true,
        provinceId: true,
        updatedAt: true,
        category: { select: { slug: true } },
        city: { select: { slug: true } },
        province: { select: { slug: true } },
      },
    });

    const visibleRows = rows.filter((row) =>
      isCategoryVisibleOnSite(row.categoryId, categoryById),
    );

    const comboMap = new Map<
      string,
      { categorySlug: string; locationSlug: string; lastmod: Date }
    >();

    for (const row of visibleRows) {
      const categorySlug = row.category?.slug;
      if (!categorySlug) continue;

      if (row.city?.slug) {
        const key = `${categorySlug}::${row.city.slug}`;
        const prev = comboMap.get(key);
        if (!prev || row.updatedAt > prev.lastmod) {
          comboMap.set(key, {
            categorySlug,
            locationSlug: row.city.slug,
            lastmod: row.updatedAt,
          });
        }
      }

      if (row.province?.slug) {
        const key = `${categorySlug}::${row.province.slug}`;
        const prev = comboMap.get(key);
        if (!prev || row.updatedAt > prev.lastmod) {
          comboMap.set(key, {
            categorySlug,
            locationSlug: row.province.slug,
            lastmod: row.updatedAt,
          });
        }
      }
    }

    const now = new Date().toISOString();
    return [...comboMap.values()].map((entry) => ({
      loc: `${this.siteOrigin}/category/${entry.categorySlug}/${entry.locationSlug}`,
      lastmod: entry.lastmod.toISOString() || now,
      changefreq: 'weekly' as const,
      priority: 0.72,
    }));
  }

  private async fetchCategoryEntries(): Promise<SitemapUrlEntry[]> {
    const allCategories = await this.prisma.category.findMany({
      select: { slug: true, id: true, parentId: true, isActive: true },
      orderBy: { title: 'asc' },
    });
    const categoryById = new Map(allCategories.map((r) => [r.id, r]));
    const rows = allCategories.filter((c) =>
      isCategoryVisibleOnSite(c.id, categoryById),
    );
    const withListings = await this.prisma.listing.groupBy({
      by: ['categoryId'],
      where: { status: ListingStatus.APPROVED, deletedAt: null },
      _count: { _all: true },
    });
    const countByCategory = new Map(
      withListings.map((g) => [g.categoryId, g._count._all]),
    );
    const now = new Date().toISOString();
    return rows
      .filter((c) => (countByCategory.get(c.id) ?? 0) > 0)
      .map((c) => ({
        loc: `${this.siteOrigin}/category/${c.slug}`,
        lastmod: now,
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
