import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingType, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CurrencyService } from '../../currency/currency.service';
import {
  AdminUpsertProductFeedDto,
  PRODUCT_FEED_CURRENCY_CODES,
  ProductFeedMarkupType,
} from '../dto/admin-product-feed.dto';
import { normalizeFeedBaseUrl } from '../utils/product-feed.util';

export interface ProductFeedConfigView {
  id: string | null;
  userId: string;
  enabled: boolean;
  feedUrl: string | null;
  currencyCode: string;
  markupType: string;
  markupValue: number;
  descriptionSuffix: string | null;
  defaultCategoryId: string | null;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastSyncStats: Prisma.JsonValue | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

@Injectable()
export class ProductFeedConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly currency: CurrencyService,
  ) {}

  async getForUser(userId: string): Promise<ProductFeedConfigView> {
    await this.assertUserExists(userId);
    const row = await this.prisma.externalProductFeed.findUnique({
      where: { userId },
    });
    return this.toView(userId, row);
  }

  async upsertForUser(
    userId: string,
    dto: AdminUpsertProductFeedDto,
  ): Promise<ProductFeedConfigView> {
    await this.assertUserExists(userId);

    const existing = await this.prisma.externalProductFeed.findUnique({
      where: { userId },
    });

    const currencyCode = (
      dto.currencyCode ??
      existing?.currencyCode ??
      'IRT'
    ).toUpperCase();
    if (
      !PRODUCT_FEED_CURRENCY_CODES.includes(
        currencyCode as (typeof PRODUCT_FEED_CURRENCY_CODES)[number],
      )
    ) {
      throw new BadRequestException('ارز انتخاب‌شده مجاز نیست');
    }

    await this.currency.assertUserCanUseCurrency(
      userId,
      currencyCode,
      ListingType.DIRECT,
    );

    const markupType = (dto.markupType ??
      existing?.markupType ??
      'NONE') as ProductFeedMarkupType;
    const markupValue =
      dto.markupValue != null
        ? Number(dto.markupValue)
        : existing
          ? Number(existing.markupValue)
          : 0;

    if (markupType === 'PERCENT' && markupValue > 500) {
      throw new BadRequestException('درصد افزایش قیمت حداکثر ۵۰۰ است');
    }
    if (markupType === 'FIXED' && markupValue < 0) {
      throw new BadRequestException('مبلغ افزایش قیمت نمی‌تواند منفی باشد');
    }
    if (markupType === 'NONE' && dto.markupValue != null && dto.markupValue !== 0) {
      // allow but normalize
    }

    let feedUrl =
      dto.feedUrl !== undefined
        ? dto.feedUrl
        : (existing?.feedUrl ?? null);
    if (feedUrl) {
      try {
        feedUrl = normalizeFeedBaseUrl(feedUrl);
        const parsed = new URL(feedUrl);
        if (parsed.protocol !== 'https:') {
          throw new Error('https required');
        }
      } catch {
        throw new BadRequestException(
          'آدرس فید باید یک URL امن (https) معتبر باشد',
        );
      }
    }

    const defaultCategoryId =
      dto.defaultCategoryId !== undefined
        ? dto.defaultCategoryId
        : (existing?.defaultCategoryId ?? null);

    if (defaultCategoryId) {
      const category = await this.prisma.category.findUnique({
        where: { id: defaultCategoryId },
        select: { id: true, isActive: true },
      });
      if (!category || !category.isActive) {
        throw new BadRequestException('دسته پیش‌فرض معتبر نیست');
      }
    }

    const enabled =
      dto.enabled != null
        ? dto.enabled
        : (existing?.enabled ?? false);

    if (enabled && !feedUrl) {
      throw new BadRequestException(
        'برای فعال‌سازی فید باید آدرس API را وارد کنید',
      );
    }

    const descriptionSuffix =
      dto.descriptionSuffix !== undefined
        ? dto.descriptionSuffix
        : (existing?.descriptionSuffix ?? null);

    const row = await this.prisma.externalProductFeed.upsert({
      where: { userId },
      create: {
        userId,
        enabled,
        feedUrl,
        currencyCode,
        markupType: markupType === 'NONE' ? 'NONE' : markupType,
        markupValue: markupType === 'NONE' ? 0 : markupValue,
        descriptionSuffix,
        defaultCategoryId,
      },
      update: {
        enabled,
        feedUrl,
        currencyCode,
        markupType: markupType === 'NONE' ? 'NONE' : markupType,
        markupValue: markupType === 'NONE' ? 0 : markupValue,
        descriptionSuffix,
        defaultCategoryId,
      },
    });

    return this.toView(userId, row);
  }

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
  }

  private toView(
    userId: string,
    row: {
      id: string;
      enabled: boolean;
      feedUrl: string | null;
      currencyCode: string;
      markupType: string;
      markupValue: Prisma.Decimal | number;
      descriptionSuffix: string | null;
      defaultCategoryId: string | null;
      lastSyncAt: Date | null;
      lastSyncStatus: string | null;
      lastSyncError: string | null;
      lastSyncStats: Prisma.JsonValue | null;
      createdAt: Date;
      updatedAt: Date;
    } | null,
  ): ProductFeedConfigView {
    if (!row) {
      return {
        id: null,
        userId,
        enabled: false,
        feedUrl: null,
        currencyCode: 'IRT',
        markupType: 'NONE',
        markupValue: 0,
        descriptionSuffix: null,
        defaultCategoryId: null,
        lastSyncAt: null,
        lastSyncStatus: null,
        lastSyncError: null,
        lastSyncStats: null,
        createdAt: null,
        updatedAt: null,
      };
    }

    return {
      id: row.id,
      userId,
      enabled: row.enabled,
      feedUrl: row.feedUrl,
      currencyCode: row.currencyCode,
      markupType: row.markupType,
      markupValue: Number(row.markupValue),
      descriptionSuffix: row.descriptionSuffix,
      defaultCategoryId: row.defaultCategoryId,
      lastSyncAt: row.lastSyncAt,
      lastSyncStatus: row.lastSyncStatus,
      lastSyncError: row.lastSyncError,
      lastSyncStats: row.lastSyncStats,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
