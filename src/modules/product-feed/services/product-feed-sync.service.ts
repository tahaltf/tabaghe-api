import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ListingImportSource,
  ListingStatus,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { NotificationService } from '../../notification/notification.service';
import {
  DeepenFeedProduct,
  parseDeepenFeedPage,
} from '../utils/deepen-feed.parser';
import {
  buildFeedPageUrl,
  normalizeFeedBaseUrl,
} from '../utils/product-feed.util';
import { ProductFeedIngestService } from './product-feed-ingest.service';
import { isDueForSync } from '../../../common/utils/min-stock-threshold.util';

export interface ProductFeedSyncResult {
  created: number;
  updated: number;
  archived: number;
  failed: number;
  skipped: number;
  errors: string[];
  status: 'SUCCESS' | 'FAILED' | 'PARTIAL';
}

export interface ProductFeedPreviewItem {
  id: string;
  title: string;
  price: number;
  oldPrice: number | null;
  category: string | null;
  image: string | null;
  isAvailable: boolean;
  stockQuantity: number;
  url: string | null;
}

export interface ProductFeedPreviewResult {
  total: number;
  products: ProductFeedPreviewItem[];
}

@Injectable()
export class ProductFeedSyncService {
  private readonly logger = new Logger(ProductFeedSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestService: ProductFeedIngestService,
    private readonly listingCommands: ListingCommandService,
    private readonly notifications: NotificationService,
  ) {}

  async previewUserFeed(userId: string): Promise<ProductFeedPreviewResult> {
    const feed = await this.requireFeedWithUrl(userId);
    const products = await this.fetchAllProducts(feed.feedUrl!);
    return {
      total: products.length,
      products: products.map((p) => ({
        id: p.id,
        title: p.title,
        price: p.price,
        oldPrice: p.oldPrice,
        category: p.category,
        image: p.image,
        isAvailable: p.isAvailable,
        stockQuantity: p.stockQuantity,
        url: p.url,
      })),
    };
  }

  async importSelectedProducts(
    userId: string,
    productIds: string[],
    categoryId?: string | null,
  ): Promise<ProductFeedSyncResult> {
    const feed = await this.requireFeedWithUrl(userId);
    await this.ingestService.assertUserCanCreateListings(userId);

    const uniqueIds = [
      ...new Set(
        productIds
          .map((id) => String(id ?? '').trim())
          .filter((id) => id.length > 0),
      ),
    ];
    if (uniqueIds.length === 0) {
      throw new BadRequestException('حداقل یک محصول باید انتخاب شود');
    }

    const selected = new Set(uniqueIds);
    const result = this.emptyResult();

    try {
      const allProducts = await this.fetchAllProducts(feed.feedUrl!);
      const products = allProducts.filter((p) => selected.has(p.id));
      if (products.length === 0) {
        throw new BadRequestException(
          'هیچ‌کدام از محصولات انتخاب‌شده در فید پیدا نشد',
        );
      }

      const missing = uniqueIds.filter(
        (id) => !products.some((p) => p.id === id),
      );
      for (const id of missing) {
        result.failed++;
        result.errors.push(`محصول ${id}: در فید پیدا نشد`);
      }

      await this.ingestProducts(
        userId,
        feed,
        products,
        result,
        categoryId ? categoryId : undefined,
      );
      await this.finalizeSyncResult(userId, result);
      return result;
    } catch (err) {
      if (!(err instanceof BadRequestException)) {
        await this.markSyncFailed(userId, err);
      }
      throw err;
    }
  }

  async syncUserFeed(userId: string): Promise<ProductFeedSyncResult> {
    const feed = await this.requireFeedWithUrl(userId);
    await this.ingestService.assertUserCanCreateListings(userId);

    const feedUrl = normalizeFeedBaseUrl(feed.feedUrl!);
    const result = this.emptyResult();

    try {
      const products = await this.fetchAllProducts(feed.feedUrl!);
      const productIds = new Set(products.map((p) => p.id));

      await this.ingestProducts(userId, feed, products, result);

      const imported = await this.prisma.listing.findMany({
        where: {
          authorId: userId,
          importSource: ListingImportSource.JSON_FEED,
          externalSiteUrl: feedUrl,
          status: { not: ListingStatus.DELETED_BY_USER },
        },
        select: { id: true, externalProductId: true },
      });

      for (const listing of imported) {
        const externalId = listing.externalProductId;
        if (!externalId || productIds.has(externalId)) continue;
        try {
          const archiveResult =
            await this.listingCommands.archiveWordPressRemovedListing(
              userId,
              listing.id,
            );
          if (archiveResult.archived) {
            result.archived++;
          }
        } catch (err) {
          result.failed++;
          result.errors.push(
            `آگهی ${listing.id}: ${(err as Error)?.message ?? 'خطای نامشخص'}`,
          );
        }
      }

      await this.finalizeSyncResult(userId, result);
      return result;
    } catch (err) {
      await this.markSyncFailed(userId, err);
      throw err;
    }
  }

  private emptyResult(): ProductFeedSyncResult {
    return {
      created: 0,
      updated: 0,
      archived: 0,
      failed: 0,
      skipped: 0,
      errors: [],
      status: 'SUCCESS',
    };
  }

  private async requireFeedWithUrl(userId: string) {
    const feed = await this.prisma.externalProductFeed.findUnique({
      where: { userId },
    });
    if (!feed?.feedUrl) {
      throw new BadRequestException('آدرس فید برای این کاربر تنظیم نشده است');
    }
    return feed;
  }

  private async ingestProducts(
    userId: string,
    feed: {
      feedUrl: string | null;
      currencyCode: string;
      markupType: string;
      markupValue: Prisma.Decimal | number;
      descriptionSuffix: string | null;
      defaultCategoryId: string | null;
      minStockForAvailable: number | null;
    },
    products: DeepenFeedProduct[],
    result: ProductFeedSyncResult,
    categoryOverride?: string | null,
  ): Promise<void> {
    const feedUrl = normalizeFeedBaseUrl(feed.feedUrl!);
    const batch = this.ingestService.createBatchIngestContext();
    const ctx = {
      feedUrl,
      currencyCode: feed.currencyCode,
      markupType: feed.markupType,
      markupValue: Number(feed.markupValue),
      descriptionSuffix: feed.descriptionSuffix,
      defaultCategoryId:
        categoryOverride !== undefined
          ? categoryOverride
          : feed.defaultCategoryId,
      minStockForAvailable: feed.minStockForAvailable ?? 1,
    };

    for (const product of products) {
      try {
        const r = await this.ingestService.ingestOne(
          userId,
          product,
          ctx,
          batch.opts,
        );
        if (r.skipped) {
          result.skipped++;
        } else if (r.archived) {
          result.archived++;
        } else if (r.created) {
          result.created++;
        } else if (r.updated) {
          result.updated++;
        }
      } catch (err) {
        result.failed++;
        result.errors.push(
          `محصول ${product.id}: ${(err as Error)?.message ?? 'خطای نامشخص'}`,
        );
      }
    }
  }

  private async finalizeSyncResult(
    userId: string,
    result: ProductFeedSyncResult,
  ): Promise<void> {
    // خلاصهٔ تغییرات فید برای ادمین؛ نوتیف تکی آگهی‌ها ارسال نمی‌شود تا تکراری نشود
    await this.notifyAdminFeedSyncSummary(userId, result);

    if (result.failed > 0 && (result.created > 0 || result.updated > 0)) {
      result.status = 'PARTIAL';
    } else if (
      result.failed > 0 &&
      result.created === 0 &&
      result.updated === 0 &&
      result.archived === 0
    ) {
      result.status = 'FAILED';
    }

    await this.prisma.externalProductFeed.update({
      where: { userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: result.status,
        lastSyncError:
          result.errors.length > 0
            ? result.errors.slice(0, 5).join(' | ').slice(0, 2000)
            : null,
        lastSyncStats: {
          created: result.created,
          updated: result.updated,
          archived: result.archived,
          failed: result.failed,
          skipped: result.skipped,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async markSyncFailed(userId: string, err: unknown): Promise<void> {
    const message = (err as Error)?.message ?? 'خطای نامشخص';
    await this.prisma.externalProductFeed.update({
      where: { userId },
      data: {
        lastSyncAt: new Date(),
        lastSyncStatus: 'FAILED',
        lastSyncError: message.slice(0, 2000),
        lastSyncStats: {
          created: 0,
          updated: 0,
          archived: 0,
          failed: 1,
          skipped: 0,
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async notifyAdminFeedSyncSummary(
    userId: string,
    result: ProductFeedSyncResult,
  ): Promise<void> {
    if (
      result.created <= 0 &&
      result.updated <= 0 &&
      result.archived <= 0
    ) {
      return;
    }

    const parts: string[] = [];
    if (result.created > 0) {
      parts.push(`${result.created} محصول جدید وارد شد`);
    }
    if (result.updated > 0) {
      parts.push(`${result.updated} محصول به‌روز شد`);
    }
    if (result.archived > 0) {
      parts.push(`${result.archived} محصول حذف شد`);
    }

    const summary = parts.join('، ');
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        phone: true,
        firstName: true,
        lastName: true,
        displayName: true,
      },
    });
    const userName =
      [user?.displayName, [user?.firstName, user?.lastName].filter(Boolean).join(' ')]
        .map((s) => (s ?? '').trim())
        .find(Boolean) ||
      user?.phone ||
      'کاربر';
    const userPhone = user?.phone ?? '—';
    const message = `${summary} — کاربر ${userName} (${userPhone})`;

    try {
      await this.notifications.notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_PRODUCT_FEED_SYNC,
        title: 'به‌روزرسانی فید محصولات',
        message,
        meta: {
          userId,
          importSource: ListingImportSource.JSON_FEED,
          createdCount: result.created,
          updatedCount: result.updated,
          archivedCount: result.archived,
          failedCount: result.failed,
          summary,
          userName,
          userPhone,
        },
      });
    } catch (err) {
      this.logger.warn(
        `Feed sync admin notify failed for ${userId}: ${
          (err as Error)?.message ?? err
        }`,
      );
    }
  }

  async syncAllEnabledFeeds(): Promise<number> {
    const feeds = await this.prisma.externalProductFeed.findMany({
      where: {
        enabled: true,
        feedUrl: { not: null },
      },
      select: {
        userId: true,
        feedUrl: true,
        lastSyncAt: true,
        syncIntervalMinutes: true,
      },
    });

    let synced = 0;
    const now = new Date();
    for (const feed of feeds) {
      if (!feed.feedUrl) continue;
      if (
        !isDueForSync(feed.lastSyncAt, feed.syncIntervalMinutes ?? 15, now)
      ) {
        continue;
      }
      try {
        await this.syncUserFeed(feed.userId);
        synced++;
      } catch (err) {
        this.logger.warn(
          `Product feed sync failed for user ${feed.userId}: ${
            (err as Error)?.message ?? err
          }`,
        );
      }
    }
    return synced;
  }

  private async fetchAllProducts(feedUrl: string): Promise<DeepenFeedProduct[]> {
    const first = await this.fetchPage(feedUrl, 1);
    const all = [...first.products];
    const pagesCount = first.pagesCount;

    for (let page = 2; page <= pagesCount; page++) {
      const next = await this.fetchPage(feedUrl, page);
      all.push(...next.products);
    }

    const byId = new Map<string, DeepenFeedProduct>();
    for (const p of all) {
      byId.set(p.id, p);
    }
    return [...byId.values()];
  }

  private async fetchPage(feedUrl: string, page: number) {
    const url = buildFeedPageUrl(feedUrl, page);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Tabaghe-ProductFeed/1.0',
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.warn(`Feed fetch failed for ${url}: ${String(err)}`);
      throw new ServiceUnavailableException(
        'اتصال به فید محصولات برقرار نشد. آدرس API را بررسی کنید.',
      );
    }

    const rawText = await response.text();
    let decoded: unknown;
    try {
      decoded = rawText ? JSON.parse(rawText) : null;
    } catch {
      throw new ServiceUnavailableException('پاسخ فید JSON معتبر نیست');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(
        `فید با وضعیت HTTP ${response.status} پاسخ داد`,
      );
    }

    try {
      return parseDeepenFeedPage(decoded);
    } catch (err) {
      throw new BadRequestException(
        (err as Error)?.message ?? 'ساختار فید قابل پردازش نیست',
      );
    }
  }
}
