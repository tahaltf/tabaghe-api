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
import {
  ListingAlertItem,
  ListingNotificationBatchService,
} from '../../../common/notification/listing-notification-batch.service';
import { applyMinStockThreshold } from '../../../common/utils/min-stock-threshold.util';
import { CreateListingDto } from '../../listing/dto/create-listing.dto';
import {
  ListingCommandService,
  WordPressSyncOptions,
  WordPressSyncUpdateInput,
} from '../../listing/services/listing-command.service';
import { RemoteImageService } from '../../wordpress-integration/services/remote-image.service';
import type { DeepenFeedProduct } from '../utils/deepen-feed.parser';
import { applyPriceMarkup } from '../utils/product-feed.util';

export type ProductFeedIngestOptions = WordPressSyncOptions & {
  skipAdminNotification?: boolean;
  onAdminAlert?: (item: ListingAlertItem) => void;
};

export interface ProductFeedIngestContext {
  feedUrl: string;
  currencyCode: string;
  markupType: string;
  markupValue: number;
  descriptionSuffix: string | null;
  defaultCategoryId: string | null;
  minStockForAvailable: number;
}

interface ListingDefaults {
  categoryId: string;
  provinceId: string;
  cityId: string;
}

@Injectable()
export class ProductFeedIngestService {
  private defaultsCache: ListingDefaults | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteImages: RemoteImageService,
    private readonly listingCommands: ListingCommandService,
    private readonly listingNotificationBatch: ListingNotificationBatchService,
  ) {}

  createBatchIngestContext() {
    const pendingAlerts: ListingAlertItem[] = [];
    return {
      opts: {
        skipAdminNotification: true,
        onAdminAlert: (item: ListingAlertItem) => pendingAlerts.push(item),
      } satisfies ProductFeedIngestOptions,
      flush: () =>
        this.listingNotificationBatch.flushAdminNewListingAlerts(pendingAlerts),
    };
  }

  async ingestOne(
    userId: string,
    product: DeepenFeedProduct,
    ctx: ProductFeedIngestContext,
    ingestOpts?: ProductFeedIngestOptions,
  ) {
    await this.assertUserCanCreateListings(userId);

    const existing = await this.prisma.listing.findFirst({
      where: {
        authorId: userId,
        externalSiteUrl: ctx.feedUrl,
        externalProductId: product.id,
      },
      include: { direct: true },
    });

    const isUpdate = !!existing;
    const hasSellablePrice = Number(product.price) > 0;
    const siteStock = hasSellablePrice
      ? applyMinStockThreshold(product.stockQuantity, ctx.minStockForAvailable)
      : 0;

    if (!hasSellablePrice) {
      if (!isUpdate) {
        return {
          listingId: null as string | null,
          status: null as string | null,
          created: false,
          updated: false,
          archived: false,
          skipped: true,
        };
      }
      return this.ingestOutOfStockUpdate(userId, existing.id, product, ctx);
    }

    const defaults = await this.resolveDefaults(userId, ctx.defaultCategoryId);
    const syncInput = await this.buildSyncInput(product, defaults, ctx, siteStock);

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
      const createDto = this.toCreateListingDto(syncInput, ctx.currencyCode);
      listing = await this.listingCommands.create(userId, createDto, {
        importSource: ListingImportSource.JSON_FEED,
        externalSiteUrl: ctx.feedUrl,
        externalProductId: product.id,
        shortDescription: syncInput.shortDescription,
        attributes: syncInput.attributes,
        adminNotificationMessage: `آگهی «${createDto.title}» (${listingTypePersianLabel(ListingType.DIRECT)}) از فید خارجی ثبت شد و در انتظار بررسی است.`,
        adminNotificationMeta: {
          importSource: ListingImportSource.JSON_FEED,
        },
        skipAdminNotification: ingestOpts?.skipAdminNotification,
        onAdminAlert: ingestOpts?.onAdminAlert,
      });
    }

    return {
      listingId: listing.id,
      status: listing.status,
      created: isNew,
      updated: !isNew,
      archived: false,
      skipped: false,
    };
  }

  private async ingestOutOfStockUpdate(
    userId: string,
    listingId: string,
    product: DeepenFeedProduct,
    ctx: ProductFeedIngestContext,
  ) {
    const defaults = await this.resolveDefaults(userId, ctx.defaultCategoryId);
    const syncInput = await this.buildSyncInput(product, defaults, ctx, 0);
    const existing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { direct: true },
    });
    if (existing?.direct && Number(syncInput.price) <= 0) {
      syncInput.price = Number(existing.direct.price);
      syncInput.compareAtPrice =
        existing.direct.compareAtPrice != null
          ? Number(existing.direct.compareAtPrice)
          : null;
      syncInput.salePrice =
        existing.direct.salePrice != null
          ? Number(existing.direct.salePrice)
          : null;
    }
    syncInput.stockQuantity = 0;

    const listing = await this.listingCommands.syncWordPressListing(
      userId,
      listingId,
      syncInput,
    );

    return {
      listingId: listing.id,
      status: listing.status,
      created: false,
      updated: true,
      archived: false,
      skipped: false,
    };
  }

  private async buildSyncInput(
    product: DeepenFeedProduct,
    defaults: ListingDefaults,
    ctx: ProductFeedIngestContext,
    siteStock: number,
  ): Promise<WordPressSyncUpdateInput> {
    const gallery = product.image
      ? await this.remoteImages.downloadMany([product.image])
      : [];
    const thumbnail = gallery[0] ?? null;

    const markedPrice = applyPriceMarkup(
      product.price,
      ctx.markupType,
      ctx.markupValue,
    );
    const markedOld =
      product.oldPrice != null && product.oldPrice > 0
        ? applyPriceMarkup(product.oldPrice, ctx.markupType, ctx.markupValue)
        : null;

    const hasSale =
      markedOld != null &&
      markedOld > 0 &&
      markedPrice > 0 &&
      markedPrice < markedOld;

    const attributesPayload = [
      ...(product.category
        ? [
            {
              name: 'دسته‌بندی منبع',
              slug: 'source_category',
              visible: true,
              variation: false,
              options: [product.category],
            },
          ]
        : []),
      ...(product.url
        ? [
            {
              name: 'لینک منبع',
              slug: 'source_url',
              visible: true,
              variation: false,
              options: [product.url],
            },
          ]
        : []),
    ];

    const descriptionParts = [
      product.title.trim(),
      product.category ? `دسته: ${product.category}` : null,
      product.url ? `منبع: ${product.url}` : null,
      ctx.descriptionSuffix?.trim() || null,
    ].filter(Boolean);

    return {
      title: product.title.trim().slice(0, 200),
      description: descriptionParts.join('\n\n'),
      shortDescription: product.category ?? null,
      attributes: attributesPayload as Prisma.InputJsonValue,
      gallery,
      thumbnail,
      price: hasSale ? markedOld! : markedPrice,
      compareAtPrice: hasSale ? markedOld : null,
      salePrice: hasSale ? markedPrice : null,
      categoryId: defaults.categoryId,
      provinceId: defaults.provinceId,
      cityId: defaults.cityId,
      stockQuantity: siteStock,
      priceCurrencyCode: ctx.currencyCode,
    };
  }

  private toCreateListingDto(
    input: WordPressSyncUpdateInput,
    currencyCode: string,
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
      priceCurrencyCode: currencyCode,
      direct: {
        price: input.price,
        compareAtPrice: input.compareAtPrice ?? null,
        salePrice: input.salePrice ?? null,
        allowExchange: false,
        shippingMethods: [],
      },
    };
  }

  private async resolveDefaults(
    userId: string,
    defaultCategoryId: string | null,
  ): Promise<ListingDefaults> {
    if (this.defaultsCache && !defaultCategoryId) {
      return this.defaultsCache;
    }

    let categoryId = defaultCategoryId;
    if (categoryId) {
      const cat = await this.prisma.category.findFirst({
        where: { id: categoryId, isActive: true },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException('دسته‌بندی پیش‌فرض فید یافت نشد');
      }
      categoryId = cat.id;
    } else {
      const category = await this.prisma.category.findFirst({
        where: { parentId: null, isActive: true },
        orderBy: { title: 'asc' },
        select: { id: true },
      });
      if (!category) {
        throw new BadRequestException('دسته‌بندی پیش‌فرض در سیستم یافت نشد');
      }
      categoryId = category.id;
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
        where: {
          slug: 'tehran',
          type: LocationType.CITY,
          parentId: province.id,
        },
        select: { id: true },
      });
    }

    if (!province || !city) {
      throw new BadRequestException('مکان پیش‌فرض در سیستم یافت نشد');
    }

    const defaults = {
      categoryId,
      provinceId: province.id,
      cityId: city.id,
    };

    if (!defaultCategoryId) {
      this.defaultsCache = defaults;
    }
    return defaults;
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
