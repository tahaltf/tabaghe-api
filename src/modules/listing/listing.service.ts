import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { DeleteListingDto } from './dto/delete-listing.dto';
import { RejectListingDto } from './dto/reject-listing.dto';
import { ListingStatus, ListingType, UserRole, Prisma } from '@prisma/client';

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
  ) {}

  // متد کمکی برای پارس کردن ایمن دیتای ورودی از FormData
  private parseNestedData(data: any) {
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        return data;
      }
    }
    return data;
  }

  async findAll(query: any = {}, page = 1, limit = 10) {
    const { province, categoryId, type, minPrice, maxPrice, search } = query;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.ListingWhereInput = {
      status: ListingStatus.APPROVED,
    };

    if (province) whereClause.province = province;
    if (categoryId) whereClause.categoryId = categoryId;
    if (type) whereClause.type = type;

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (minPrice || maxPrice) {
      const min = minPrice ? Number(minPrice) : 0;
      const max = maxPrice ? Number(maxPrice) : Number.MAX_SAFE_INTEGER;

      const priceConditions = [
        { direct: { price: { gte: min, lte: max } } },
        { auction: { basePrice: { gte: min, lte: max } } },
        { exchange: { ownValue: { gte: min, lte: max } } },
      ];

      whereClause.AND = [...(whereClause.AND as any[] || []), { OR: priceConditions }];
    }

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where: whereClause,
        include: { direct: true, auction: true, exchange: true, author: { select: { firstName: true, lastName: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.listing.count({ where: whereClause }),
    ]);

    return {
      data: items,
      meta: { total, page, lastPage: Math.ceil(total / limit) }
    };
  }

  async findAllByUser(userId: string) {
    return this.prisma.listing.findMany({
      where: { authorId: userId },
      include: { direct: true, auction: true, exchange: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findAllForAdmin(status?: ListingStatus) {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: { direct: true, auction: true, exchange: true, author: { select: { phone: true, firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: { direct: true, auction: true, exchange: true, author: { select: { firstName: true, lastName: true, phone: true } } },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    return listing;
  }

  async create(userId: string, dto: any) {
    // پارس کردن داده‌های تودرتو چون از FormData می‌آیند
    const direct = this.parseNestedData(dto.direct);
    const exchange = this.parseNestedData(dto.exchange);
    const auction = this.parseNestedData(dto.auction);

    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          authorId: userId,
          type: dto.type,
          status: ListingStatus.PENDING,
          title: dto.title,
          categoryId: dto.categoryId,
          condition: dto.condition,
          description: dto.description,
          province: dto.province,
          city: dto.city,
          shippingPayer: dto.shippingPayer,
          thumbnail: dto.thumbnail,
          gallery: dto.gallery ?? [],
          direct: dto.type === ListingType.DIRECT && direct ? {
            create: {
              price: direct.price,
              allowExchange: direct.allowExchange,
              shippingMethods: direct.shippingMethods,
            }
          } : undefined,
          exchange: (dto.type === ListingType.EXCHANGE || (dto.type === ListingType.DIRECT && direct?.allowExchange)) ? {
            create: {
              desiredCategoryId: exchange?.desiredCategoryId || '',
              desiredTitle: exchange?.desiredTitle || '',
              desiredDescription: exchange?.desiredDescription,
              ownValue: exchange?.ownValue || 0,
              extraPaymentAmount: exchange?.extraPaymentAmount || 0,
              acceptOtherItems: exchange?.acceptOtherItems || false,
              allowDirectSale: exchange?.allowDirectSale || false,
              directPrice: exchange?.directPrice,
            }
          } : undefined,
          auction: dto.type === ListingType.AUCTION && auction ? {
            create: {
              basePrice: auction.basePrice,
              minBidIncrement: auction.minBidIncrement,
              endDatetime: auction.endDatetime,
              buyNowEnabled: auction.buyNowEnabled,
              buyNowPrice: auction.buyNowPrice,
            }
          } : undefined,
        },
      });

      await this.quotaService.consumeOnCreate(tx, userId, dto.type, listing.id);
      return listing;
    });
  }

  async update(userId: string, listingId: string, dto: any) {
    const listing = await this.findOne(listingId);
    if (listing.authorId !== userId) throw new ForbiddenException('شما مالک این آگهی نیستید');

    const direct = this.parseNestedData(dto.direct);
    const exchange = this.parseNestedData(dto.exchange);
    const auction = this.parseNestedData(dto.auction);

    if (listing.type === ListingType.AUCTION && listing.auction?.highestBidderId && dto.type && dto.type !== ListingType.AUCTION) {
      throw new BadRequestException('مزایده دارای پیشنهاد فعال است و قابل تغییر نیست');
    }

    const currentType = dto.type || listing.type;

    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        title: dto.title,
        description: dto.description,
        province: dto.province,
        city: dto.city,
        condition: dto.condition,
        categoryId: dto.categoryId,
        shippingPayer: dto.shippingPayer,
        thumbnail: dto.thumbnail,
        gallery: dto.gallery,
        type: currentType,
        status: ListingStatus.PENDING,

        direct: currentType === ListingType.DIRECT && direct ? {
          upsert: {
            create: { price: direct.price || 0, allowExchange: direct.allowExchange || false, shippingMethods: direct.shippingMethods || [] },
            update: { price: direct.price, allowExchange: direct.allowExchange, shippingMethods: direct.shippingMethods }
          }
        } : (listing.direct ? { delete: true } : undefined),

        exchange: ((currentType === ListingType.EXCHANGE || (currentType === ListingType.DIRECT && direct?.allowExchange)) && exchange) ? {
          upsert: {
            create: {
              desiredCategoryId: exchange.desiredCategoryId || '',
              desiredTitle: exchange.desiredTitle || '',
              ownValue: exchange.ownValue || 0
            },
            update: {
              desiredCategoryId: exchange.desiredCategoryId,
              desiredTitle: exchange.desiredTitle,
              ownValue: exchange.ownValue,
              extraPaymentAmount: exchange.extraPaymentAmount
            }
          }
        } : (listing.exchange ? { delete: true } : undefined),

        auction: currentType === ListingType.AUCTION && auction ? {
          upsert: {
            create: { basePrice: auction.basePrice || 0, minBidIncrement: auction.minBidIncrement || 50000, endDatetime: auction.endDatetime || new Date() },
            update: { basePrice: auction.basePrice, minBidIncrement: auction.minBidIncrement, endDatetime: auction.endDatetime }
          }
        } : (listing.auction ? { delete: true } : undefined),
      },
    });
  }

  async delete(userId: string, listingId: string, dto: DeleteListingDto) {
    const listing = await this.findOne(listingId);
    if (listing.authorId !== userId) throw new ForbiddenException('دسترسی ندارید');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.DELETED_BY_USER, deleteReason: dto.deleteReason, deletedAt: new Date() },
    });
  }

  async approve(listingId: string, role: UserRole) {
    if (role !== UserRole.ADMIN) throw new ForbiddenException('فقط ادمین');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.APPROVED, approvedAt: new Date() },
    });
  }

  async reject(listingId: string, role: UserRole, dto: RejectListingDto) {
    if (role !== UserRole.ADMIN) throw new ForbiddenException('فقط ادمین');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: { status: ListingStatus.REJECTED, rejectionReason: dto.rejectionReason, rejectedAt: new Date() },
      });
      await this.quotaService.releaseOnReject(tx, listingId);
      return updated;
    });
  }

  private validateTypePayload(dto: CreateListingDto) {
    // چون در FormData داده‌ها ممکن است استرینگ باشند، در اینجا باید احتیاط کرد
    // اما چون قبلاً در سرویس پارس شده‌اند، متد Create از آبجکت‌های واقعی استفاده می‌کند.
  }
}