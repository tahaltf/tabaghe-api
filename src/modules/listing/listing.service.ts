import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { QuotaService } from '../quota/quota.service';
import { ListingStatus, ListingType, UserRole, Prisma } from '@prisma/client';

@Injectable()
export class ListingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotaService: QuotaService,
  ) {}

  private parseNestedData(data: any) {
    if (!data) return null;
    if (typeof data === 'string') {
      try {
        return JSON.parse(data);
      } catch (e) {
        return data;
      }
    }
    return data;
  }

  private parseBoolean(value: any): boolean {
    return value === true || value === 'true';
  }

  // ======================================================
  // PUBLIC GET ENDPOINTS
  // ======================================================

  async findAll(query: any = {}, page = 1, limit = 10) {
    const { provinceId, categoryId, type, minPrice, maxPrice, search, sort } = query;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.ListingWhereInput = {
      status: ListingStatus.APPROVED,
    };

    if (provinceId) whereClause.provinceId = provinceId;
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

      whereClause.AND = [
        {
          OR: [
            { direct: { price: { gte: min, lte: max } } },
            { auction: { basePrice: { gte: min, lte: max } } },
            { exchange: { ownValue: { gte: min, lte: max } } },
          ]
        }
      ];
    }

    let orderBy: Prisma.ListingOrderByWithRelationInput = { createdAt: 'desc' };

    if (sort === 'price_asc') orderBy = { direct: { price: 'asc' } };
    else if (sort === 'price_desc') orderBy = { direct: { price: 'desc' } };
    else if (sort === 'oldest') orderBy = { createdAt: 'asc' };

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where: whereClause,
        include: {
          direct: true,
          auction: true,
          exchange: true,
          province: { select: { name: true, id: true } },
          city: { select: { name: true, id: true } },
          category: { select: { title: true, id: true } },
          author: { select: { firstName: true, lastName: true, avatar: true, isVerified: true } }
        },
        orderBy,
        skip,
        take: limit,
      }),
      this.prisma.listing.count({ where: whereClause }),
    ]);

    return { data: items, meta: { total, page, lastPage: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: {
        direct: true,
        auction: {
          include: {
            bids: {
              orderBy: { amount: 'desc' },
              take: 10,
              include: { bidder: { select: { firstName: true, lastName: true, avatar: true } } }
            }
          }
        },
        exchange: true,
        province: { select: { name: true, id: true } },
        city: { select: { name: true, id: true } },
        category: { select: { title: true, id: true } },
        author: {
          select: {
            firstName: true,
            lastName: true,
            phone: true,
            avatar: true,
            isVerified: true,
            rating: true,
            isOnline: true
          }
        },
      },
    });
    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    return listing;
  }

  async checkAvailability(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { status: true }
    });
    return listing?.status === ListingStatus.APPROVED;
  }

  // ======================================================
  // ACTION ENDPOINTS (Create / Update / Delete)
  // ======================================================

  async createExchangeOffer(userId: string, dto: any, files: Array<Express.Multer.File>) {
    const imagePaths = files?.map(file => file.filename).filter(Boolean) || [];

    return this.prisma.exchangeOffer.create({
      data: {
        listingId: dto.listingId,
        offererId: userId,
        title: dto.offeredItem,
        description: dto.description,
        extraPayment: Number(dto.cashAmount || 0),
        isPayerMe: this.parseBoolean(dto.isPayerMe),
        images: imagePaths,
        status: 'PENDING'
      }
    });
  }

  async getExchangeOffer(id: string, userId: string) {
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            id: true,
            title: true,
            thumbnail: true,
            shippingPayer: true,
            authorId: true,
            author: { select: { firstName: true, lastName: true, id: true } },
            direct: { select: { price: true } },
            exchange: { select: { ownValue: true } }
          }
        }
      }
    });

    if (!offer) throw new NotFoundException('درخواست معاوضه‌ای یافت نشد');
    if (offer.offererId !== userId && offer.listing.authorId !== userId) {
      throw new ForbiddenException('شما دسترسی به این درخواست را ندارید');
    }

    const targetPrice = Number(offer.listing.direct?.price || offer.listing.exchange?.ownValue || 0);
    const extraPaymentAmount = Number(offer.extraPayment || 0);

    const offeredPrice = offer.isPayerMe
      ? targetPrice - extraPaymentAmount
      : targetPrice + extraPaymentAmount;

    return {
      success: true,
      data: {
        id: offer.id,
        status: offer.status,
        targetListing: offer.listing,
        offeredListing: {
          id: 'custom-offer',
          title: offer.title,
          thumbnail: offer.images && offer.images.length > 0 ? offer.images[0] : null,
          authorId: offer.offererId,
          direct: { price: offeredPrice }
        }
      }
    };
  }

  async getAuctionCheckoutData(listingId: string, userId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: {
        auction: {
          include: {
            bids: {
              where: { bidderId: userId },
              orderBy: { amount: 'desc' },
              take: 1
            }
          }
        },
        author: { select: { firstName: true, lastName: true, id: true } },
      }
    });

    if (!listing || !listing.auction) {
      throw new NotFoundException('آگهی مزایده یافت نشد');
    }

    const userBid = listing.auction.bids[0];
    if (!userBid) {
      throw new ForbiddenException('شما هیچ پیشنهادی در این مزایده ندارید');
    }

    const bidAmount = Number(userBid.amount || 0);
    const guaranteePercentage = 0.10; // ۱۰ درصد ضمانت
    const blockedAmount = bidAmount * guaranteePercentage;
    const payableAmount = bidAmount - blockedAmount;

    return {
      success: true,
      data: {
        listing: {
          id: listing.id,
          title: listing.title,
          thumbnail: listing.thumbnail,
          shippingPayer: listing.shippingPayer,
          author: listing.author
        },
        bidAmount: bidAmount,
        blockedAmount: blockedAmount,
        payableAmount: payableAmount
      }
    };
  }

  async create(userId: string, dto: any) {
    if (!dto.categoryId || !dto.provinceId || !dto.cityId || !dto.type) {
      throw new BadRequestException('اطلاعات دسته‌بندی و موقعیت مکانی الزامی است');
    }

    const direct = this.parseNestedData(dto.direct) || {};
    const exchange = this.parseNestedData(dto.exchange) || {};
    const auction = this.parseNestedData(dto.auction) || {};

    let auctionEndDate: Date | undefined;
    if (dto.type === ListingType.AUCTION) {
      if (!auction.endDatetime) throw new BadRequestException('زمان پایان مزایده الزامی است');
      auctionEndDate = new Date(auction.endDatetime);
      if (auctionEndDate.getTime() <= Date.now()) {
        throw new BadRequestException('زمان پایان مزایده نمی‌تواند در گذشته باشد');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.create({
        data: {
          title: dto.title,
          type: dto.type,
          status: ListingStatus.PENDING,
          condition: dto.condition,
          description: dto.description,
          shippingPayer: dto.shippingPayer,
          thumbnail: dto.thumbnail,
          gallery: dto.gallery ?? [],
          author: { connect: { id: userId } },
          category: { connect: { id: dto.categoryId } },
          province: { connect: { id: dto.provinceId } },
          city: { connect: { id: dto.cityId } },
          direct: dto.type === ListingType.DIRECT ? {
            create: {
              price: Number(direct.price || 0),
              allowExchange: this.parseBoolean(direct.allowExchange),
              shippingMethods: direct.shippingMethods || [],
            },
          } : undefined,
          exchange: (dto.type === ListingType.EXCHANGE || (dto.type === ListingType.DIRECT && this.parseBoolean(direct.allowExchange))) ? {
            create: {
              desiredCategoryId: exchange.desiredCategoryId || '',
              desiredTitle: exchange.desiredTitle || '',
              ownValue: Number(exchange.ownValue || 0),
              extraPaymentAmount: Number(exchange.extraPaymentAmount || 0),
            },
          } : undefined,
          auction: dto.type === ListingType.AUCTION && auctionEndDate ? {
            create: {
              basePrice: Number(auction.basePrice || 0),
              minBidIncrement: Number(auction.minBidIncrement || 5000),
              endDatetime: auctionEndDate,
            },
          } : undefined,
        },
      });

      await this.quotaService.consumeOnCreate(tx, userId, dto.type, listing.id);
      return listing;
    });
  }

  async update(userId: string, listingId: string, dto: any) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { direct: true, exchange: true, auction: true },
    });

    if (!listing) throw new NotFoundException('آگهی یافت نشد');
    if (listing.authorId !== userId) throw new ForbiddenException('شما دسترسی ویرایش این آگهی را ندارید');

    const direct = this.parseNestedData(dto.direct);
    const exchange = this.parseNestedData(dto.exchange);
    const auction = this.parseNestedData(dto.auction);
    const currentType = dto.type || listing.type;

    let auctionEndDate = (currentType === ListingType.AUCTION && auction?.endDatetime)
      ? new Date(auction.endDatetime)
      : listing.auction?.endDatetime;

    return this.prisma.listing.update({
      where: { id: listingId },
      data: {
        title: dto.title,
        description: dto.description,
        condition: dto.condition,
        shippingPayer: dto.shippingPayer,
        thumbnail: dto.thumbnail,
        gallery: dto.gallery,
        type: currentType,
        status: ListingStatus.PENDING,
        ...(dto.categoryId && { category: { connect: { id: dto.categoryId } } }),
        ...(dto.provinceId && { province: { connect: { id: dto.provinceId } } }),
        ...(dto.cityId && { city: { connect: { id: dto.cityId } } }),

        direct: currentType === ListingType.DIRECT && direct ? {
          upsert: {
            create: { price: Number(direct.price || 0), allowExchange: this.parseBoolean(direct.allowExchange), shippingMethods: direct.shippingMethods || [] },
            update: { price: Number(direct.price || 0), allowExchange: this.parseBoolean(direct.allowExchange), shippingMethods: direct.shippingMethods || [] },
          },
        } : (listing.direct ? { delete: true } : undefined),

        exchange: (currentType === ListingType.EXCHANGE || (currentType === ListingType.DIRECT && this.parseBoolean(direct?.allowExchange))) && exchange ? {
          upsert: {
            create: { desiredCategoryId: exchange.desiredCategoryId || '', desiredTitle: exchange.desiredTitle || '', ownValue: Number(exchange.ownValue || 0), extraPaymentAmount: Number(exchange.extraPaymentAmount || 0) },
            update: { desiredCategoryId: exchange.desiredCategoryId, desiredTitle: exchange.desiredTitle, ownValue: Number(exchange.ownValue || 0), extraPaymentAmount: Number(exchange.extraPaymentAmount || 0) },
          },
        } : (listing.exchange ? { delete: true } : undefined),

        auction: currentType === ListingType.AUCTION && auction && auctionEndDate ? {
          upsert: {
            create: { basePrice: Number(auction.basePrice || 0), minBidIncrement: Number(auction.minBidIncrement || 5000), endDatetime: auctionEndDate },
            update: { basePrice: Number(auction.basePrice || 0), minBidIncrement: Number(auction.minBidIncrement || 5000), endDatetime: auctionEndDate },
          },
        } : (listing.auction ? { delete: true } : undefined),
      },
    });
  }

  async delete(userId: string, listingId: string, dto: any) {
    const listing = await this.findOne(listingId);
    if (listing.authorId !== userId) throw new ForbiddenException('شما دسترسی حذف این آگهی را ندارید');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.DELETED_BY_USER, deleteReason: dto.deleteReason, deletedAt: new Date() },
    });
  }

  async findAllByUser(userId: string) {
    return this.prisma.listing.findMany({
      where: { authorId: userId },
      include: {
        direct: true,
        auction: true,
        exchange: true,
        province: { select: { name: true } },
        city: { select: { name: true } },
        category: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ======================================================
  // SAVED LISTINGS
  // ======================================================

  async toggleSave(userId: string, listingId: string) {
    const existing = await this.prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } },
    });

    if (existing) {
      await this.prisma.savedListing.delete({ where: { id: existing.id } });
      return { saved: false };
    } else {
      await this.prisma.savedListing.create({ data: { userId, listingId } });
      return { saved: true };
    }
  }

  async getSavedListings(userId: string) {
    const saved = await this.prisma.savedListing.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            category: true,
            author: { select: { firstName: true, lastName: true, avatar: true } },
            direct: true,
            auction: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return saved.map((s) => s.listing);
  }

  async isListingSaved(userId: string, listingId: string) {
    const existing = await this.prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } }
    });
    return { saved: !!existing };
  }

  // ======================================================
  // ADMIN METHODS
  // ======================================================

  async approve(listingId: string, role: UserRole) {
    if (role !== UserRole.ADMIN) throw new ForbiddenException('عدم دسترسی');
    return this.prisma.listing.update({
      where: { id: listingId },
      data: { status: ListingStatus.APPROVED, approvedAt: new Date() },
    });
  }

  async reject(listingId: string, role: UserRole, dto: any) {
    if (role !== UserRole.ADMIN) throw new ForbiddenException('عدم دسترسی');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.listing.update({
        where: { id: listingId },
        data: { status: ListingStatus.REJECTED, rejectionReason: dto.rejectionReason, rejectedAt: new Date() },
      });
      await this.quotaService.releaseOnReject(tx, listingId);
      return updated;
    });
  }

  async findAllForAdmin(status?: ListingStatus) {
    return this.prisma.listing.findMany({
      where: status ? { status } : {},
      include: {
        direct: true,
        auction: true,
        exchange: true,
        province: { select: { name: true } },
        city: { select: { name: true } },
        category: { select: { title: true } },
        author: { select: { phone: true, firstName: true, lastName: true, avatar: true, isVerified: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}