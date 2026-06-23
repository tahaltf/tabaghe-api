import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';

import {

  ItemCondition,

  ListingImportSource,

  ListingType,

  LocationType,

  Prisma,

  ShippingPayer,

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

      return this.ingestUnavailableUpdate(userId, existing.id, dto);

    }



    if (dto.status && dto.status !== 'publish' && !isUpdate) {

      throw new BadRequestException('فقط محصولات منتشرشده قابل ارسال هستند');

    }



    const defaults = await this.resolveDefaults(userId);

    const syncInput = await this.buildSyncInput(userId, dto, defaults);



    let listing;

    let isNew = false;



    if (existing) {

      listing = await this.listingCommands.syncWordPressListing(

        userId,

        existing.id,

        syncInput,

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

      });

    }



    await this.connectionService.touchSync(userId);



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

    listingId: string,

    dto: WordPressProductDto,

  ) {

    const defaults = await this.resolveDefaults(userId);

    const syncInput = await this.buildSyncInput(userId, dto, defaults);

    const { listing, archived } =

      await this.listingCommands.archiveWordPressUnavailableListing(

        userId,

        listingId,

        syncInput,

      );



    await this.connectionService.touchSync(userId);



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

  ): Promise<WordPressSyncUpdateInput> {

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



    return {

      title: dto.title.trim(),

      description: dto.description,

      shortDescription: dto.shortDescription ?? null,

      attributes: attributesPayload as Prisma.InputJsonValue,

      gallery,

      thumbnail,

      price,

      categoryId: defaults.categoryId,

      provinceId: defaults.provinceId,

      cityId: defaults.cityId,

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

      thumbnail: input.thumbnail ?? undefined,

      gallery: input.gallery,

      direct: {

        price: input.price,

        allowExchange: false,

        shippingMethods: [],

      },

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


