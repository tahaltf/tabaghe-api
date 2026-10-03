import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import {

  ItemCondition,

  ListingImportSource,

  ListingType,

  LocationType,

  Prisma,

  ShippingPayer,

  UserStatus,

} from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

import { listingTypePersianLabel } from '../../../common/system-settings/listing-type-enabled';

import { CreateListingDto } from '../../listing/dto/create-listing.dto';

import {

  ListingCommandService,

  WordPressSyncUpdateInput,

} from '../../listing/services/listing-command.service';

import { WordPressProductDto } from '../dto/wordpress-product.dto';

import { RemoteImageService } from './remote-image.service';

import { WordPressConnectionService } from './connection.service';

import { buildWordPressListingDescription } from '../utils/wordpress-description.util';

import { WordPressCategoriesService } from './wordpress-categories.service';
import {
  ListingAlertItem,
  ListingNotificationBatchService,
} from '../../../common/notification/listing-notification-batch.service';
import type { WordPressSyncOptions } from '../../listing/services/listing-command.service';
import {
  applyMinStockThreshold,
  normalizeMinStockForAvailable,
} from '../../../common/utils/min-stock-threshold.util';

export type WordPressIngestOptions = WordPressSyncOptions & {
  skipAdminNotification?: boolean;
  onAdminAlert?: (item: ListingAlertItem) => void;
};

interface ListingDefaults {

  categoryId: string;

  provinceId: string;

  cityId: string;

}

@Injectable()

export class WordPressProductIngestService {

  private defaultsCache: ListingDefaults | null = null;

  constructor(

    private readonly prisma: PrismaService,

    private readonly remoteImages: RemoteImageService,

    private readonly connectionService: WordPressConnectionService,

    private readonly listingCommands: ListingCommandService,

    private readonly categoriesService: WordPressCategoriesService,

    private readonly listingNotificationBatch: ListingNotificationBatchService,

  ) {}

  createBatchIngestContext() {
    const pendingAlerts: ListingAlertItem[] = [];
    return {
      opts: {
        skipAdminNotification: true,
        onAdminAlert: (item: ListingAlertItem) => pendingAlerts.push(item),
      } satisfies WordPressIngestOptions,
      flush: () =>
        this.listingNotificationBatch.flushAdminNewListingAlerts(pendingAlerts),
    };
  }

  async ingestOne(
    userId: string,
    dto: WordPressProductDto,
    ingestOpts?: WordPressIngestOptions,
  ) {

    await this.assertUserCanCreateListings(userId);

    const existing = await this.prisma.listing.findFirst({

      where: {

        authorId: userId,

        externalSiteUrl: dto.siteUrl,

        externalProductId: dto.externalProductId,

      },

      include: { direct: true },

    });

    const isUpdate = !!existing;
    const minStock = await this.connectionService.getMinStockForAvailable(userId);
    const availability = this.resolveAvailability(dto, minStock);

    // پیش‌نویس / حذف‌شده از وردپرس → آرشیو (اگر قبلاً وارد شده)
    if (!availability.isPublished) {
      if (!isUpdate) {
        throw new BadRequestException(
          'فقط محصولات منتشرشده قابل ارسال هستند',
        );
      }
      return this.ingestUnavailableUpdate(userId, existing.id, dto);
    }

    const defaults = await this.resolveDefaults(userId);
    const categoryId = await this.resolveCategoryId(dto, defaults);
    const syncInput = await this.buildSyncInput(
      userId,
      dto,
      defaults,
      categoryId,
      availability.siteStock,
    );

    let listing;

    let isNew = false;

    if (existing) {

      listing = await this.listingCommands.syncWordPressListing(

        userId,

        existing.id,

        syncInput,

        ingestOpts,

      );

    } else {

      isNew = true;

      const createDto = this.toCreateListingDto(syncInput);

      listing = await this.listingCommands.create(userId, createDto, {

        importSource: ListingImportSource.WORDPRESS,

        externalSiteUrl: dto.siteUrl,

        externalProductId: dto.externalProductId,

        shortDescription: syncInput.shortDescription,

        attributes: syncInput.attributes,

        adminNotificationMessage: `آگهی «${createDto.title}» (${listingTypePersianLabel(ListingType.DIRECT)}) از وردپرس ثبت شد و در انتظار بررسی است.`,

        adminNotificationMeta: {

          importSource: ListingImportSource.WORDPRESS,

        },

        skipAdminNotification: ingestOpts?.skipAdminNotification,

        onAdminAlert: ingestOpts?.onAdminAlert,

      });

    }

    await this.connectionService.recordProductActivity(userId, dto.siteUrl);

    return {

      listingId: listing.id,

      status: listing.status,

      created: isNew,

      updated: !isNew,

    };

  }

  async ingestBulk(userId: string, products: WordPressProductDto[]) {

    const batch = this.createBatchIngestContext();

    const results = [];

    for (const product of products) {

      try {

        results.push({

          externalProductId: product.externalProductId,

          ok: true,

          ...(await this.ingestOne(userId, product, batch.opts)),

        });

      } catch (err) {

        results.push({

          externalProductId: product.externalProductId,

          ok: false,

          error: (err as Error)?.message ?? 'خطای نامشخص',

        });

      }

    }

    await batch.flush();

    return { results };

  }

  /**
   * isPublished=false → آرشیو/رد ایجاد
   * siteStock=0 با isPublished=true → روی سایت ناموجود (بدون آرشیو)
   */
  private resolveAvailability(
    dto: WordPressProductDto,
    minStockForAvailable: number,
  ): { isPublished: boolean; siteStock: number } {
    if (dto.status && dto.status !== 'publish') {
      return { isPublished: false, siteStock: 0 };
    }

    const min = normalizeMinStockForAvailable(minStockForAvailable);
    const raw = dto.stockQuantity;
    const hasNumericStock =
      raw != null && Number.isFinite(Number(raw)) && Number(raw) >= 0;

    if (hasNumericStock) {
      return {
        isPublished: true,
        siteStock: applyMinStockThreshold(Number(raw), min),
      };
    }

    // موجودی مدیریت نمی‌شود — فلگ‌های موجودی ووکامرس
    if (dto.inStock === false) {
      return { isPublished: true, siteStock: 0 };
    }
    const stockStatus = dto.stockStatus?.toLowerCase();
    if (stockStatus === 'outofstock' || stockStatus === 'out_of_stock') {
      return { isPublished: true, siteStock: 0 };
    }
    return { isPublished: true, siteStock: Math.max(1, min) };
  }

  /**
   * WooCommerce may report an inconsistent discount (e.g. an empty regular
   * price while a sale price is set, so the effective price equals the sale
   * price). Instead of failing the entire sync — which also blocks marking a
   * product as unavailable — we degrade gracefully: keep a valid positive base
   * price and only apply the discount when it is strictly below the base price.
   */
  private resolveSyncPricing(dto: WordPressProductDto): {
    price: number;
    compareAtPrice: number | null;
    salePrice: number | null;
  } {
    const explicitRegular =
      dto.regularPrice != null ? Number(dto.regularPrice) : null;
    const effectivePrice = Number(dto.price ?? 0);
    let saleRaw = dto.salePrice != null ? Number(dto.salePrice) : null;

    // List/original price: prefer regularPrice, otherwise the payload price.
    let listPrice =
      explicitRegular != null &&
      Number.isFinite(explicitRegular) &&
      explicitRegular > 0
        ? explicitRegular
        : effectivePrice;

    // Older plugins may send effective `price` below regular without salePrice.
    if (
      (saleRaw == null || !Number.isFinite(saleRaw) || saleRaw <= 0) &&
      Number.isFinite(effectivePrice) &&
      effectivePrice > 0 &&
      Number.isFinite(listPrice) &&
      effectivePrice < listPrice
    ) {
      saleRaw = effectivePrice;
    }

    // If payload `price` was the sale amount (WC convention) but regular exists,
    // keep listPrice as the higher original amount.
    if (
      saleRaw != null &&
      Number.isFinite(saleRaw) &&
      saleRaw > 0 &&
      Number.isFinite(listPrice) &&
      listPrice <= saleRaw &&
      explicitRegular != null &&
      Number.isFinite(explicitRegular) &&
      explicitRegular > saleRaw
    ) {
      listPrice = explicitRegular;
    }

    const hasValidSale =
      saleRaw != null &&
      Number.isFinite(saleRaw) &&
      saleRaw > 0 &&
      Number.isFinite(listPrice) &&
      listPrice > 0 &&
      saleRaw < listPrice;

    return {
      price: Number.isFinite(listPrice) ? listPrice : 0,
      compareAtPrice: hasValidSale ? listPrice : null,
      salePrice: hasValidSale ? saleRaw : null,
    };
  }

  private async ingestUnavailableUpdate(

    userId: string,

    listingId: string,

    dto: WordPressProductDto,

  ) {

    const defaults = await this.resolveDefaults(userId);

    const categoryId = await this.resolveCategoryId(dto, defaults);

    const syncInput = await this.buildSyncInput(userId, dto, defaults, categoryId, 0);

    const { listing, archived } =

      await this.listingCommands.archiveWordPressUnavailableListing(

        userId,

        listingId,

        syncInput,

      );

    await this.connectionService.recordProductActivity(userId, dto.siteUrl);

    return {

      listingId: listing.id,

      status: listing.status,

      created: false,

      updated: true,

      archived,

    };

  }

  private async buildSyncInput(
    userId: string,
    dto: WordPressProductDto,
    defaults: ListingDefaults,
    categoryId: string,
    siteStock: number,
  ): Promise<WordPressSyncUpdateInput> {

    const imageUrls = dto.images

      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))

      .map((img) => img.url);

    const gallery = await this.remoteImages.downloadMany(imageUrls);

    const thumbnail = gallery[0] ?? null;

    const { price: regularPrice, compareAtPrice, salePrice } =
      this.resolveSyncPricing(dto);

    const attributesPayload = dto.attributes.map((attr) => ({

      name: attr.name,

      slug: attr.slug,

      visible: attr.visible,

      variation: attr.variation,

      options: attr.options,

    }));

    const description = buildWordPressListingDescription(dto);

    const priceCurrencyCode = dto.priceCurrencyCode?.trim()
      ? dto.priceCurrencyCode.trim().toUpperCase()
      : null;

    return {

      title: dto.title.trim(),

      description,

      shortDescription: dto.shortDescription ?? null,

      attributes: attributesPayload as Prisma.InputJsonValue,

      gallery,

      thumbnail,

      price: regularPrice,

      compareAtPrice,

      salePrice,

      categoryId,

      provinceId: defaults.provinceId,

      cityId: defaults.cityId,

      stockQuantity: siteStock,

      priceCurrencyCode,

    };

  }

  private toCreateListingDto(

    input: WordPressSyncUpdateInput,

  ): CreateListingDto {

    return {

      type: ListingType.DIRECT,

      title: input.title,

      categoryId: input.categoryId,

      provinceId: input.provinceId,

      cityId: input.cityId,

      condition: ItemCondition.NEW,

      description: input.description,

      shippingPayer: ShippingPayer.BUYER_PREPAID,

      stockQuantity: input.stockQuantity,

      thumbnail: input.thumbnail ?? undefined,

      gallery: input.gallery,

      priceCurrencyCode: input.priceCurrencyCode ?? undefined,

      direct: {

        price: input.price,

        compareAtPrice: input.compareAtPrice ?? null,

        salePrice: input.salePrice ?? null,

        allowExchange: false,

        shippingMethods: [],

      },

    };

  }

  private async resolveCategoryId(

    dto: WordPressProductDto,

    defaults: ListingDefaults,

  ): Promise<string> {

    const categoryId = dto.categoryId?.trim();

    if (!categoryId) {

      return defaults.categoryId;

    }

    await this.categoriesService.assertCategoryAllowed(categoryId);

    return categoryId;

  }

  private async resolveDefaults(userId: string): Promise<ListingDefaults> {

    if (this.defaultsCache) return this.defaultsCache;

    const category = await this.prisma.category.findFirst({

      where: { parentId: null, isActive: true },

      orderBy: { title: 'asc' },

      select: { id: true },

    });

    if (!category) {

      throw new BadRequestException('دسته‌بندی پیش‌فرض در سیستم یافت نشد');

    }

    const userAddress = await this.prisma.address.findFirst({

      where: { userId },

      orderBy: { createdAt: 'asc' },

      select: { province: true, city: true },

    });

    let province = userAddress

      ? await this.prisma.location.findFirst({

          where: { name: userAddress.province, type: LocationType.PROVINCE },

          select: { id: true },

        })

      : null;

    let city =

      userAddress && province

        ? await this.prisma.location.findFirst({

            where: {

              name: userAddress.city,

              type: LocationType.CITY,

              parentId: province.id,

            },

            select: { id: true },

          })

        : null;

    if (!province) {

      province = await this.prisma.location.findFirst({

        where: { slug: 'ostan-tehran', type: LocationType.PROVINCE },

        select: { id: true },

      });

    }

    if (!city && province) {

      city = await this.prisma.location.findFirst({

        where: { slug: 'tehran', type: LocationType.CITY, parentId: province.id },

        select: { id: true },

      });

    }

    if (!province || !city) {

      throw new BadRequestException('مکان پیش‌فرض در سیستم یافت نشد');

    }

    this.defaultsCache = {

      categoryId: category.id,

      provinceId: province.id,

      cityId: city.id,

    };

    return this.defaultsCache;

  }

  async assertUserCanCreateListings(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, isVerified: true },
    });

    if (!user || user.status === UserStatus.INCOMPLETE || !user.isVerified) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'عدم دسترسی',
        message:
          'حساب کاربری شما هنوز تایید نشده است. لطفاً پروفایل خود را تکمیل کنید.',
        code: 'PROFILE_INCOMPLETE',
      });
    }
  }

}

