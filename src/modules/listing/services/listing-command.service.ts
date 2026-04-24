import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ExchangeOfferStatus,
  ExchangePayer,
  Listing,
  ListingStatus,
  ListingType,
  OrderStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { QuotaService } from '../../quota/quota.service';
import { CreateListingDto } from '../dto/create-listing.dto';
import { UpdateListingDto } from '../dto/update-listing.dto';
import { DeleteListingDto } from '../dto/delete-listing.dto';

@Injectable()
export class ListingCommandService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
  ) {}

  async create(userId: string, dto: CreateListingDto): Promise<Listing> {
    this.validateListingPayload(dto, false);
    const auctionEndDate = this.resolveAuctionEndDate(dto);

    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          title: dto.title,
          type: dto.type,
          status: ListingStatus.PENDING,
          condition: dto.condition,
          description: dto.description ?? '',
          shippingPayer: dto.shippingPayer,
          exchangePayer: dto.exchangePayer ?? ExchangePayer.NONE,
          sellerRequiresVerification: dto.sellerRequiresVerification ?? false,
          thumbnail: dto.thumbnail,
          gallery: dto.gallery ?? [],
          author: { connect: { id: userId } },
          category: { connect: { id: dto.categoryId } },
          province: { connect: { id: dto.provinceId } },
          city: { connect: { id: dto.cityId } },
          direct:
            dto.type === ListingType.DIRECT
              ? {
                  create: {
                    price: dto.direct?.price ?? 0,
                    allowExchange: dto.direct?.allowExchange ?? false,
                    shippingMethods: dto.direct?.shippingMethods ?? [],
                  },
                }
              : undefined,
          exchange:
            this.shouldCreateExchange(dto)
              ? {
                  create: {
                    desiredCategoryId: dto.exchange?.desiredCategoryId ?? '',
                    desiredTitle: dto.exchange?.desiredTitle ?? '',
                    desiredDescription: dto.exchange?.desiredDescription,
                    ownValue: dto.exchange?.ownValue ?? 0,
                    extraPaymentAmount: dto.exchange?.extraPaymentAmount ?? 0,
                  },
                }
              : undefined,
          auction:
            dto.type === ListingType.AUCTION && auctionEndDate
              ? {
                  create: {
                    basePrice: dto.auction?.basePrice ?? 0,
                    minBidIncrement: dto.auction?.minBidIncrement ?? 5000,
                    endDatetime: auctionEndDate,
                    buyNowEnabled: dto.auction?.buyNowEnabled ?? false,
                    buyNowPrice: dto.auction?.buyNowPrice,
                  },
                }
              : undefined,
        },
      });

      await this.quotaService.consumeOnCreate(tx, userId, dto.type, listing.id);
      return listing;
    });
  }

  async update(
    userId: string,
    listingId: string,
    dto: UpdateListingDto,
  ): Promise<Listing> {
    await this.ensureListingCanBeModified(listingId, userId);

    const listing = await this.prisma.listing.findUniqueOrThrow({
      where: { id: listingId },
      include: { direct: true, exchange: true, auction: true },
    });

    const currentType = dto.type ?? listing.type;
    this.validateListingPayload(dto, true, currentType);
    const auctionEndDate =
      currentType === ListingType.AUCTION && dto.auction?.endDatetime
        ? new Date(dto.auction.endDatetime)
        : listing.auction?.endDatetime ?? undefined;

    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        title: dto.title,
        description: dto.description,
        condition: dto.condition,
        shippingPayer: dto.shippingPayer,
        exchangePayer: dto.exchangePayer ?? listing.exchangePayer,
        sellerRequiresVerification:
          dto.sellerRequiresVerification ?? listing.sellerRequiresVerification,
        thumbnail: dto.thumbnail,
        gallery: dto.gallery,
        type: currentType,
        status: ListingStatus.PENDING,
        ...(dto.categoryId && {
          category: { connect: { id: dto.categoryId } },
        }),
        ...(dto.provinceId && {
          province: { connect: { id: dto.provinceId } },
        }),
        ...(dto.cityId && { city: { connect: { id: dto.cityId } } }),
        direct: this.buildDirectUpsert(currentType, dto, listing),
        exchange: this.buildExchangeUpsert(currentType, dto, listing),
        auction: this.buildAuctionUpsert(currentType, dto, listing, auctionEndDate),
      },
    });
  }

  async softDelete(
    userId: string,
    listingId: string,
    dto: DeleteListingDto,
  ): Promise<Listing> {
    await this.ensureListingCanBeModified(listingId, userId);

    return this.prisma.$transaction(async (tx) => {
      await tx.exchangeOffer.deleteMany({ where: { listingId } });
      return tx.listing.update({
        where: { id: listingId },
        data: {
          status: ListingStatus.DELETED_BY_USER,
          deleteReason: dto.deleteReason,
          deletedAt: new Date(),
        },
      });
    });
  }

  private resolveAuctionEndDate(dto: CreateListingDto): Date | undefined {
    if (dto.type !== ListingType.AUCTION) return undefined;
    if (!dto.auction?.endDatetime) {
      throw new BadRequestException('زمان پایان مزایده الزامی است');
    }
    if (
      dto.auction?.minBidIncrement !== undefined &&
      dto.auction.minBidIncrement < 5000
    ) {
      throw new BadRequestException('حداقل گام افزایش مزایده باید حداقل ۵۰۰۰ باشد');
    }
    const end = new Date(dto.auction.endDatetime);
    if (end.getTime() <= Date.now()) {
      throw new BadRequestException('زمان پایان مزایده نمی‌تواند در گذشته باشد');
    }
    return end;
  }

  private validateListingPayload(
    dto: CreateListingDto | UpdateListingDto,
    isUpdate: boolean,
    resolvedType?: ListingType,
  ): void {
    const type = resolvedType ?? dto.type;
    if (!type) {
      throw new BadRequestException('نوع آگهی مشخص نیست. لطفاً نوع آگهی را انتخاب کنید.');
    }

    const missing: string[] = [];
    const hasText = (v: unknown) => typeof v === 'string' && v.trim().length > 0;

    if (!isUpdate || dto.title !== undefined) {
      if (!hasText(dto.title)) missing.push('عنوان آگهی');
    }
    if (!isUpdate || dto.categoryId !== undefined) {
      if (!hasText(dto.categoryId)) missing.push('دسته‌بندی');
    }
    if (!isUpdate || dto.provinceId !== undefined) {
      if (!hasText(dto.provinceId)) missing.push('استان');
    }
    if (!isUpdate || dto.cityId !== undefined) {
      if (!hasText(dto.cityId)) missing.push('شهر');
    }

    if (type === ListingType.DIRECT) {
      const price = dto.direct?.price;
      if (price === undefined || Number(price) <= 0) {
        missing.push('قیمت فروش (باید بیشتر از صفر باشد)');
      }
    }

    if (type === ListingType.EXCHANGE || (type === ListingType.DIRECT && dto.direct?.allowExchange)) {
      if (!hasText(dto.exchange?.desiredTitle)) {
        missing.push('نام کالای درخواستی برای معاوضه');
      }
      if (!hasText(dto.exchange?.desiredCategoryId)) {
        missing.push('دسته‌بندی کالای درخواستی برای معاوضه');
      }
    }

    if (type === ListingType.AUCTION) {
      const basePrice = dto.auction?.basePrice;
      if (basePrice === undefined || Number(basePrice) <= 0) {
        missing.push('قیمت پایه مزایده (باید بیشتر از صفر باشد)');
      }
      if (!dto.auction?.endDatetime) {
        missing.push('زمان پایان مزایده');
      }
    }

    if (missing.length) {
      throw new BadRequestException(
        `برای ثبت آگهی، این موارد را تکمیل کنید: ${missing.join('، ')}`,
      );
    }
  }

  private shouldCreateExchange(dto: CreateListingDto): boolean {
    if (dto.type === ListingType.EXCHANGE) return true;
    if (dto.type === ListingType.DIRECT && dto.direct?.allowExchange) return true;
    return false;
  }

  private async ensureListingCanBeModified(
    listingId: string,
    userId: string,
  ): Promise<Listing> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId } });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId !== userId) {
      throw new ForbiddenException('شما مالک این آگهی نیستید');
    }
    if (listing.status === ListingStatus.SOLD) {
      throw new BadRequestException('کالای فروخته شده قابل ویرایش یا حذف نیست');
    }

    const activeOrder = await this.prisma.order.findFirst({
      where: {
        listingId,
        status: { notIn: [OrderStatus.CANCELLED] },
      },
      select: { id: true },
    });
    if (activeOrder) {
      throw new BadRequestException(
        'این آگهی در جریان یک سفارش فعال است و قفل شده است.',
      );
    }

    if (listing.type === ListingType.AUCTION) {
      const bidCount = await this.prisma.auctionBid.count({ where: { listingId } });
      if (bidCount > 0) {
        throw new BadRequestException(
          'روی این مزایده پیشنهاد مالی ثبت شده است و دیگر قابل تغییر یا حذف نیست.',
        );
      }
    }

    const acceptedExchange = await this.prisma.exchangeOffer.findFirst({
      where: { listingId, status: ExchangeOfferStatus.ACCEPTED },
      select: { id: true },
    });
    if (acceptedExchange) {
      throw new BadRequestException(
        'این آگهی در یک معامله معاوضه تایید شده قرار دارد و قفل شده است.',
      );
    }

    return listing;
  }

  private buildDirectUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { direct: { listingId: string } | null },
  ): Prisma.ListingDirectUpdateOneWithoutListingNestedInput | undefined {
    if (type === ListingType.DIRECT && dto.direct) {
      const data = {
        price: dto.direct.price ?? 0,
        allowExchange: dto.direct.allowExchange ?? false,
        shippingMethods: dto.direct.shippingMethods ?? [],
      };
      return { upsert: { create: data, update: data } };
    }
    return current.direct ? { delete: true } : undefined;
  }

  private buildExchangeUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { exchange: { listingId: string } | null },
  ): Prisma.ListingExchangeUpdateOneWithoutListingNestedInput | undefined {
    const shouldKeep =
      (type === ListingType.EXCHANGE ||
        (type === ListingType.DIRECT && dto.direct?.allowExchange)) &&
      !!dto.exchange;

    if (shouldKeep && dto.exchange) {
      const data = {
        desiredCategoryId: dto.exchange.desiredCategoryId ?? '',
        desiredTitle: dto.exchange.desiredTitle ?? '',
        ownValue: dto.exchange.ownValue ?? 0,
        extraPaymentAmount: dto.exchange.extraPaymentAmount ?? 0,
      };
      return { upsert: { create: data, update: data } };
    }
    return current.exchange ? { delete: true } : undefined;
  }

  private buildAuctionUpsert(
    type: ListingType,
    dto: UpdateListingDto,
    current: { auction: { listingId: string } | null },
    endDate: Date | undefined,
  ): Prisma.ListingAuctionUpdateOneWithoutListingNestedInput | undefined {
    if (type === ListingType.AUCTION && dto.auction && endDate) {
      const data = {
        basePrice: dto.auction.basePrice ?? 0,
        minBidIncrement: dto.auction.minBidIncrement ?? 5000,
        endDatetime: endDate,
      };
      return { upsert: { create: data, update: data } };
    }
    return current.auction ? { delete: true } : undefined;
  }
}
