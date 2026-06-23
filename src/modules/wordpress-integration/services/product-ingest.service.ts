import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  ItemCondition,
  ListingImportSource,
  ListingStatus,
  ListingType,
  LocationType,
  NotificationType,
  Prisma,
  ShippingPayer,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { listingTypePersianLabel } from '../../../common/system-settings/listing-type-enabled';
import { WordPressProductDto } from '../dto/wordpress-product.dto';
import { RemoteImageService } from './remote-image.service';
import { WordPressConnectionService } from './connection.service';

interface ListingDefaults {
  categoryId: string;
  provinceId: string;
  cityId: string;
}

@Injectable()
export class WordPressProductIngestService {
  private readonly logger = new Logger(WordPressProductIngestService.name);
  private defaultsCache: ListingDefaults | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly remoteImages: RemoteImageService,
    private readonly connectionService: WordPressConnectionService,
    private readonly notifications: NotificationService,
  ) {}

  async ingestOne(userId: string, dto: WordPressProductDto) {
    const existing = await this.prisma.listing.findFirst({
      where: {
        authorId: userId,
        externalSiteUrl: dto.siteUrl,
        externalProductId: dto.externalProductId,
      },
      include: { direct: true },
    });

    const isUpdate = !!existing;
    const isAvailable = this.isProductAvailable(dto);

    if (!isAvailable) {
      if (!isUpdate) {
        throw new BadRequestException(
          'فقط محصولات منتشرشده و موجود قابل ارسال هستند',
        );
      }
      return this.ingestUnavailableUpdate(userId, existing, dto);
    }

    if (dto.status && dto.status !== 'publish' && !isUpdate) {
      throw new BadRequestException('فقط محصولات منتشرشده قابل ارسال هستند');
    }

    const defaults = await this.resolveDefaults(userId);
    const imageUrls = dto.images
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((img) => img.url);
    const gallery = await this.remoteImages.downloadMany(imageUrls);
    const thumbnail = gallery[0] ?? null;
    const price = dto.salePrice ?? dto.price;

    const attributesPayload = dto.attributes.map((attr) => ({
      name: attr.name,
      slug: attr.slug,
      visible: attr.visible,
      variation: attr.variation,
      options: attr.options,
    }));

    const listingData: Prisma.ListingUpdateInput = {
      title: dto.title.trim(),
      description: dto.description,
      shortDescription: dto.shortDescription ?? null,
      attributes: attributesPayload as Prisma.InputJsonValue,
      gallery,
      thumbnail,
      importSource: ListingImportSource.WORDPRESS,
      externalSiteUrl: dto.siteUrl,
      externalProductId: dto.externalProductId,
      category: { connect: { id: defaults.categoryId } },
      province: { connect: { id: defaults.provinceId } },
      city: { connect: { id: defaults.cityId } },
      type: ListingType.DIRECT,
      condition: ItemCondition.NEW,
      shippingPayer: ShippingPayer.BUYER_PREPAID,
      direct: {
        upsert: {
          create: {
            price,
            allowExchange: false,
            shippingMethods: [],
          },
          update: {
            price,
          },
        },
      },
    };

    let listing;
    let isNew = false;

    if (existing) {
      const shouldResetPending =
        existing.status === ListingStatus.REJECTED ||
        existing.status === ListingStatus.PENDING;
      const shouldRestoreApproved =
        existing.status === ListingStatus.ARCHIVED &&
        existing.importSource === ListingImportSource.WORDPRESS;

      listing = await this.prisma.listing.update({
        where: { id: existing.id },
        data: {
          ...listingData,
          ...(shouldResetPending ? { status: ListingStatus.PENDING } : {}),
          ...(shouldRestoreApproved ? { status: ListingStatus.APPROVED } : {}),
        },
        include: { direct: true },
      });
    } else {
      isNew = true;
      listing = await this.prisma.listing.create({
        data: {
          authorId: userId,
          title: dto.title.trim(),
          description: dto.description,
          shortDescription: dto.shortDescription ?? null,
          attributes: attributesPayload as Prisma.InputJsonValue,
          gallery,
          thumbnail,
          importSource: ListingImportSource.WORDPRESS,
          externalSiteUrl: dto.siteUrl,
          externalProductId: dto.externalProductId,
          categoryId: defaults.categoryId,
          provinceId: defaults.provinceId,
          cityId: defaults.cityId,
          type: ListingType.DIRECT,
          status: ListingStatus.PENDING,
          condition: ItemCondition.NEW,
          shippingPayer: ShippingPayer.BUYER_PREPAID,
          direct: {
            create: {
              price,
              allowExchange: false,
              shippingMethods: [],
            },
          },
        },
        include: { direct: true },
      });
    }

    await this.connectionService.touchSync(userId);

    if (isNew) {
      void this.notifications
        .notifyAdminPersonnel({
          type: NotificationType.ADMIN_ALERT_NEW_LISTING,
          title: 'آگهی جدید در انتظار تایید',
          message: `آگهی «${listing.title}» (${listingTypePersianLabel(listing.type)}) از وردپرس ثبت شد و در انتظار بررسی است.`,
          meta: {
            listingId: listing.id,
            userId,
            listingTitle: listing.title,
            listingType: listing.type,
            importSource: ListingImportSource.WORDPRESS,
          },
        })
        .catch((err) => {
          this.logger.warn(
            `Admin notify failed for WP listing ${listing.id}: ${String(err)}`,
          );
        });
    }

    return {
      listingId: listing.id,
      status: listing.status,
      created: isNew,
      updated: !isNew,
    };
  }

  async ingestBulk(userId: string, products: WordPressProductDto[]) {
    const results = [];
    for (const product of products) {
      try {
        results.push({
          externalProductId: product.externalProductId,
          ok: true,
          ...(await this.ingestOne(userId, product)),
        });
      } catch (err) {
        results.push({
          externalProductId: product.externalProductId,
          ok: false,
          error: (err as Error)?.message ?? 'خطای نامشخص',
        });
      }
    }
    return { results };
  }

  private isProductAvailable(dto: WordPressProductDto): boolean {
    if (dto.status && dto.status !== 'publish') {
      return false;
    }
    if (dto.inStock === false) {
      return false;
    }
    const stockStatus = dto.stockStatus?.toLowerCase();
    if (stockStatus === 'outofstock' || stockStatus === 'out_of_stock') {
      return false;
    }
    return true;
  }

  private async ingestUnavailableUpdate(
    userId: string,
    existing: { id: string; status: ListingStatus },
    dto: WordPressProductDto,
  ) {
    const imageUrls = dto.images
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((img) => img.url);
    const gallery = await this.remoteImages.downloadMany(imageUrls);
    const thumbnail = gallery[0] ?? null;
    const price = dto.salePrice ?? dto.price;

    const attributesPayload = dto.attributes.map((attr) => ({
      name: attr.name,
      slug: attr.slug,
      visible: attr.visible,
      variation: attr.variation,
      options: attr.options,
    }));

    const shouldArchive = existing.status === ListingStatus.APPROVED;

    const listing = await this.prisma.listing.update({
      where: { id: existing.id },
      data: {
        title: dto.title.trim(),
        description: dto.description,
        shortDescription: dto.shortDescription ?? null,
        attributes: attributesPayload as Prisma.InputJsonValue,
        gallery,
        thumbnail,
        ...(shouldArchive ? { status: ListingStatus.ARCHIVED } : {}),
        direct: {
          upsert: {
            create: {
              price,
              allowExchange: false,
              shippingMethods: [],
            },
            update: { price },
          },
        },
      },
      include: { direct: true },
    });

    await this.connectionService.touchSync(userId);

    return {
      listingId: listing.id,
      status: listing.status,
      created: false,
      updated: true,
      archived: shouldArchive,
    };
  }

  private async resolveDefaults(userId: string): Promise<ListingDefaults> {
    if (this.defaultsCache) return this.defaultsCache;

    const category =
      (await this.prisma.category.findFirst({
        where: { slug: 'mobile-tablet', isActive: true },
        select: { id: true },
      })) ??
      (await this.prisma.category.findFirst({
        where: { parentId: null, isActive: true },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      }));

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
}
