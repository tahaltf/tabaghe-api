import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ListingImportSource,
  ListingStatus,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { ListingCommandService } from '../../listing/services/listing-command.service';
import { WordPressProductDto } from '../dto/wordpress-product.dto';
import { WordPressConnectionService } from './connection.service';
import { WordPressProductIngestService } from './product-ingest.service';

interface WordPressStoreCatalogResponse {
  productIds: string[];
  products: WordPressProductDto[];
}

export interface WordPressImportedListingItem {
  id: string;
  title: string;
  thumbnail: string | null;
  status: ListingStatus;
  externalProductId: string | null;
  externalSiteUrl: string | null;
  price: number | null;
  updatedAt: Date;
}

export interface WordPressStoreSyncResult {
  updated: number;
  archived: number;
  failed: number;
  errors: string[];
}

@Injectable()
export class WordPressStoreSyncService {
  private readonly logger = new Logger(WordPressStoreSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectionService: WordPressConnectionService,
    private readonly ingestService: WordPressProductIngestService,
    private readonly listingCommands: ListingCommandService,
  ) {}

  async listImportedListings(
    userId: string,
  ): Promise<WordPressImportedListingItem[]> {
    const rows = await this.prisma.listing.findMany({
      where: {
        authorId: userId,
        importSource: ListingImportSource.WORDPRESS,
        status: { not: ListingStatus.DELETED_BY_USER },
      },
      include: { direct: true },
      orderBy: { updatedAt: 'desc' },
    });

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      thumbnail: row.thumbnail,
      status: row.status,
      externalProductId: row.externalProductId,
      externalSiteUrl: row.externalSiteUrl,
      price: row.direct?.price != null ? Number(row.direct.price) : null,
      updatedAt: row.updatedAt,
    }));
  }

  async syncFromStore(userId: string): Promise<WordPressStoreSyncResult> {
    const connection = await this.prisma.wordPressConnection.findUnique({
      where: { userId },
    });

    if (!connection?.siteUrl || !connection.catalogSecret) {
      throw new BadRequestException(
        'فروشگاه وردپرس هنوز برای همگام‌سازی از پنل طبقه آماده نیست. افزونه را نصب کنید، توکن را وارد کنید و چند دقیقه صبر کنید تا اتصال برقرار شود.',
      );
    }

    const catalog = await this.fetchCatalog(
      connection.siteUrl,
      connection.catalogSecret,
    );
    const imported = await this.prisma.listing.findMany({
      where: {
        authorId: userId,
        importSource: ListingImportSource.WORDPRESS,
        status: { not: ListingStatus.DELETED_BY_USER },
      },
      select: {
        id: true,
        externalProductId: true,
      },
    });

    const catalogIds = new Set(catalog.productIds.map(String));
    const catalogByExternalId = new Map(
      catalog.products.map((product) => [product.externalProductId, product]),
    );

    let updated = 0;
    let archived = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const listing of imported) {
      const externalId = listing.externalProductId;
      if (!externalId) {
        continue;
      }

      if (!catalogIds.has(externalId)) {
        try {
          const result = await this.listingCommands.archiveWordPressRemovedListing(
            userId,
            listing.id,
          );
          if (result.archived) {
            archived++;
          }
        } catch (err) {
          failed++;
          errors.push(
            `آگهی ${listing.id}: ${(err as Error)?.message ?? 'خطای نامشخص'}`,
          );
        }
        continue;
      }

      const payload = catalogByExternalId.get(externalId);
      if (!payload) {
        continue;
      }

      try {
        await this.ingestService.ingestOne(userId, payload);
        updated++;
      } catch (err) {
        failed++;
        errors.push(
          `محصول ${externalId}: ${(err as Error)?.message ?? 'خطای نامشخص'}`,
        );
      }
    }

    await this.connectionService.touchSync(userId);

    return { updated, archived, failed, errors };
  }

  private async fetchCatalog(
    siteUrl: string,
    catalogSecret: string,
  ): Promise<WordPressStoreCatalogResponse> {
    const base = siteUrl.replace(/\/+$/, '');
    const url = `${base}/wp-json/tabagheh/v1/catalog`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'X-Tabagheh-Catalog-Secret': catalogSecret,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      this.logger.warn(`WP catalog fetch failed for ${url}: ${String(err)}`);
      throw new ServiceUnavailableException(
        'اتصال به فروشگاه وردپرس برقرار نشد. آدرس سایت و دسترسی REST API را بررسی کنید.',
      );
    }

    const raw = await response.text();
    let decoded: unknown;
    try {
      decoded = raw ? JSON.parse(raw) : null;
    } catch {
      throw new ServiceUnavailableException(
        'پاسخ نامعتبر از فروشگاه وردپرس دریافت شد.',
      );
    }

    if (!response.ok) {
      const message =
        decoded &&
        typeof decoded === 'object' &&
        decoded !== null &&
        'message' in decoded &&
        typeof (decoded as { message?: unknown }).message === 'string'
          ? (decoded as { message: string }).message
          : `خطای HTTP ${response.status} از فروشگاه وردپرس`;
      throw new BadRequestException(message);
    }

    const data =
      decoded &&
      typeof decoded === 'object' &&
      decoded !== null &&
      'data' in decoded
        ? (decoded as { data: unknown }).data
        : decoded;

    if (!data || typeof data !== 'object' || data === null) {
      throw new ServiceUnavailableException(
        'ساختار کاتالوگ وردپرس نامعتبر است.',
      );
    }

    const payload = data as {
      productIds?: unknown;
      products?: unknown;
    };

    const productIds = Array.isArray(payload.productIds)
      ? payload.productIds.map((id) => String(id))
      : [];
    const products = Array.isArray(payload.products)
      ? (payload.products as WordPressProductDto[])
      : [];

    return { productIds, products };
  }
}
