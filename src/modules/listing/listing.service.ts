import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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

  // --- عمومی (Public) ---

// در فایل listing.service.ts سمت بک‌اِند
  // --- عمومی (Public) ---

  async findAll(query: any = {}, page = 1, limit = 10) {
    // ✅ هماهنگی کامل با پارامترهای ارسالی از فرانت‌اِند
    const { provinceId, categoryId, type, minPrice, maxPrice, search, sort } = query;
    const skip = (page - 1) * limit;

    const whereClause: Prisma.ListingWhereInput = {
      status: ListingStatus.APPROVED,
    };

    // ✅ فیلتر بر اساس استان (Province) به جای شهر
    if (provinceId) whereClause.provinceId = provinceId;
    if (categoryId) whereClause.categoryId = categoryId;
    if (type) whereClause.type = type;

    if (search) {
      whereClause.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    // ✅ فیلتر قیمت (هندل کردن انواع آگهی)
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

    // ✅ اصلاح لاجیک مرتب‌سازی (Sort)
    let orderBy: Prisma.ListingOrderByWithRelationInput = { createdAt: 'desc' };

    if (sort === 'price_asc') {
      // توجه: Prisma اجازه سورت روی فیلدهای nullable در رابطه‌ها را با شرایط خاص می‌دهد
      orderBy = { direct: { price: 'asc' } };
    } else if (sort === 'price_desc') {
      orderBy = { direct: { price: 'desc' } };
    } else if (sort === 'oldest') {
      orderBy = { createdAt: 'asc' };
    }

    const [items, total] = await Promise.all([
      this.prisma.listing.findMany({
        where: whereClause,
        include: {
          direct: true,
          auction: true,
          exchange: true,
          province: { select: { name: true, id: true } }, // ✅ اضافه شد برای نمایش نام استان
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
              // ✅ اصلاح: در مدل شما رابطه bidder نام دارد، نه user
              include: { bidder: { select: { firstName: true, lastName: true } } }
            }
          }
        },
        exchange: true,
        province: { select: { name: true, id: true } },
        city: { select: { name: true, id: true } },
        category: { select: { title: true, id: true } },
        // ✅ اصلاح: دریافت فیلدهای پروفایل و تایید هویت
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


  async placeBid(userId: string, listingId: string, amount: number) {
    return this.prisma.$transaction(async (tx) => {
      const listing = await tx.listing.findUnique({
        where: { id: listingId },
        include: { auction: true },
      });

      if (!listing || !listing.auction) throw new BadRequestException('آگهی مزایده نیست');
      if (new Date() > listing.auction.endDatetime) throw new BadRequestException('زمان تمام شده');

      const currentPrice = Number(listing.auction.basePrice);
      const minIncrement = Number(listing.auction.minBidIncrement);
      const minRequiredBid = currentPrice + minIncrement;

      // ✅ شرط بررسی گام افزایش
      if (amount < minRequiredBid) {
        throw new BadRequestException(`مبلغ پیشنهادی باید حداقل ${minRequiredBid.toLocaleString()} تومان باشد (گام افزایش: ${minIncrement})`);
      }

      // ثبت بید... (بقیه کد مثل قبل)
      const bid = await tx.auctionBid.create({
        data: { amount, bidderId: userId, listingId }
      });

      await tx.listingAuction.update({
        where: { listingId },
        data: { basePrice: amount }
      });

      return bid;
    });
  }

// در فایل listing.service.ts

  async createExchangeOffer(userId: string, dto: any, files: Array<Express.Multer.File>) {
    const imagePaths: string[] = [];

    // بررسی فایل‌ها
    if (files && files.length > 0) {
      files.forEach(file => {
        // ✅ الان چون در کنترلر ذخیره کردیم، filename وجود دارد
        if (file.filename) {
          imagePaths.push(file.filename);
        }
      });
    }

    return this.prisma.exchangeOffer.create({
      data: {
        listingId: dto.listingId,
        offererId: userId,
        title: dto.offeredItem,
        description: dto.description,
        extraPayment: Number(dto.cashAmount || 0),
        // تبدیل استرینگ 'true'/'false' به بولین
        isPayerMe: dto.isPayerMe === 'true' || dto.isPayerMe === true,
        images: imagePaths, // ✅ الان آرایه ای از رشته هاست: ["abc.jpg", "xyz.png"]
        status: 'PENDING'
      }
    });
  }
  async checkAvailability(listingId: string) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: { status: true }
    });
    return listing?.status === ListingStatus.APPROVED;
  }

  // --- مدیریت آگهی (CRUD) ---

  async create(userId: string, dto: any) {
    const direct = this.parseNestedData(dto.direct) || {};
    const exchange = this.parseNestedData(dto.exchange) || {};
    const auction = this.parseNestedData(dto.auction) || {};

    if (!dto.categoryId) throw new BadRequestException('انتخاب دسته‌بندی الزامی است');

    let auctionEndDate: Date | undefined;
    if (dto.type === ListingType.AUCTION && auction.endDatetime) {
      auctionEndDate = new Date(auction.endDatetime);
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
              allowExchange: !!direct.allowExchange,
              shippingMethods: direct.shippingMethods || [],
            },
          } : undefined,
          exchange: (dto.type === ListingType.EXCHANGE || (dto.type === ListingType.DIRECT && direct.allowExchange)) ? {
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
    if (listing.authorId !== userId) throw new ForbiddenException('عدم دسترسی');

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
            create: { price: Number(direct.price || 0), allowExchange: !!direct.allowExchange, shippingMethods: direct.shippingMethods || [] },
            update: { price: Number(direct.price || 0), allowExchange: !!direct.allowExchange, shippingMethods: direct.shippingMethods || [] },
          },
        } : (listing.direct ? { delete: true } : undefined),

        exchange: (currentType === ListingType.EXCHANGE || (currentType === ListingType.DIRECT && direct?.allowExchange)) && exchange ? {
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

  async delete(userId: string, listingId: string, dto: any) {
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

  async reject(listingId: string, role: UserRole, dto: any) {
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
  // در listing.service.ts

// 1. متد ذخیره/حذف نشان
  async toggleSave(userId: string, listingId: string) {
    const existing = await this.prisma.savedListing.findUnique({
      where: {
        userId_listingId: {
          userId,
          listingId,
        },
      },
    });

    if (existing) {
      await this.prisma.savedListing.delete({
        where: { id: existing.id },
      });
      return { saved: false };
    } else {
      await this.prisma.savedListing.create({
        data: {
          userId,
          listingId,
        },
      });
      return { saved: true };
    }
  }

// 2. متد دریافت لیست نشان‌شده‌ها
  async getSavedListings(userId: string) {
    const saved = await this.prisma.savedListing.findMany({
      where: { userId },
      include: {
        listing: {
          include: {
            category: true,
            author: {
              select: { firstName: true, lastName: true, avatar: true },
            },
            direct: true,
            auction: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return saved.map((s) => s.listing);
  }

// 3. متد چک کردن وضعیت (اختیاری)
  async isListingSaved(userId: string, listingId: string) {
    const existing = await this.prisma.savedListing.findUnique({
      where: { userId_listingId: { userId, listingId } }
    });
    return { saved: !!existing };
  }
}