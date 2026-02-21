import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserStatus, AuctionStatus, ListingStatus, ExchangeOfferStatus, UserRole } from '@prisma/client';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, phone: true, email: true, firstName: true, lastName: true,
        nationalCode: true, shabaNumber: true, nationalCardImage: true,
        avatar: true, bio: true, notifyEmail: true, notifySms: true,
        notifyPush: true, status: true, role: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return { data: user };
  }

  async getDashboardStats(userId: string) {
    // ۱. دریافت بیدهای فعال
    const activeBids = await this.prisma.auctionBid.findMany({
      where: {
        bidderId: userId,
        auction: { status: AuctionStatus.ACTIVE },
      },
      distinct: ['listingId'],
      include: {
        auction: {
          include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
        },
      },
    });

    let highestBidderCount = 0;
    for (const bid of activeBids) {
      const topBid = bid.auction?.bids[0];
      if (topBid && topBid.bidderId === userId) {
        highestBidderCount++;
      }
    }

    // ۲. محاسبه برده‌ها
    const finishedBids = await this.prisma.auctionBid.findMany({
      where: {
        bidderId: userId,
        auction: { status: AuctionStatus.FINISHED },
      },
      distinct: ['listingId'],
      include: {
        auction: {
          include: { bids: { orderBy: { amount: 'desc' }, take: 1 } },
        },
      },
    });

    let wonBidsCount = 0;
    for (const bid of finishedBids) {
      if (bid.auction?.bids[0]?.bidderId === userId) wonBidsCount++;
    }

    // ۳. سایر آمارها
    const exchangeOffersReceived = await this.prisma.exchangeOffer.count({
      where: {
        listing: { authorId: userId },
        status: ExchangeOfferStatus.PENDING,
      },
    });

    const activeListings = await this.prisma.listing.count({
      where: {
        authorId: userId,
        status: ListingStatus.APPROVED,
      },
    });

    // دریافت مستقیم و دقیق موجودی از کیف پول (جایگزین حلقه محاسباتی ناامن)
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    return {
      activeAuctions: activeBids.length,
      highestBidderCount,
      wonBids: wonBidsCount,
      exchangeOffersReceived,
      balanceBlocked: wallet?.balanceBlocked || 0,
      balanceAvailable: wallet?.balanceAvailable || 0,
      activeListings,
      remainingQuota: Math.max(0, 10 - activeListings),
    };
  }

  async completeProfile(userId: string, data: { firstName: string, lastName: string, nationalCode: string, shabaNumber: string, nationalCardImage: string }) {
    const existingUser = await this.prisma.user.findFirst({
      where: { nationalCode: data.nationalCode, NOT: { id: userId } },
    });

    if (existingUser) throw new BadRequestException('این کد ملی قبلاً در سیستم ثبت شده است.');

    // نرمال‌سازی شماره شبا (حذف IR در صورت وجود)
    const cleanShaba = data.shabaNumber.replace(/^IR/i, '').trim();
    if (cleanShaba.length !== 24) {
      throw new BadRequestException('شماره شبا باید ۲۴ رقم باشد.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: data.firstName,
        lastName: data.lastName,
        nationalCode: data.nationalCode,
        shabaNumber: cleanShaba,
        nationalCardImage: data.nationalCardImage,
        status: UserStatus.PENDING
      },
    });
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    try {
      const updateData: any = {
        firstName: dto.firstName,
        lastName: dto.lastName,
        email: dto.email,
        bio: dto.bio,
        avatar: dto.avatar,
        notifyEmail: String(dto.notifyEmail) === 'true',
        notifySms: String(dto.notifySms) === 'true',
        notifyPush: String(dto.notifyPush) === 'true',
      };

      if (dto.nationalCardImage) {
        updateData.nationalCardImage = dto.nationalCardImage;
        updateData.status = UserStatus.PENDING;
      }

      return await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
          id: true, email: true, firstName: true, lastName: true, avatar: true, status: true
        }
      });
    } catch (error: any) {
      if (error.code === 'P2002') throw new BadRequestException('این ایمیل قبلاً ثبت شده است.');
      throw error;
    }
  }

  // ==========================================
  // متدهای ادمین (KYC Moderation)
  // ==========================================

  async getPendingKycRequests() {
    return this.prisma.user.findMany({
      where: { status: UserStatus.PENDING },
      select: {
        id: true, firstName: true, lastName: true, phone: true,
        nationalCode: true, shabaNumber: true, nationalCardImage: true, createdAt: true
      },
      orderBy: { updatedAt: 'asc' }
    });
  }

  async approveKyc(adminId: string, targetUserId: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== UserRole.ADMIN) throw new ForbiddenException('عدم دسترسی');

    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: UserStatus.APPROVED, isVerified: true },
    });
  }

  async rejectKyc(adminId: string, targetUserId: string, reason: string) {
    const admin = await this.prisma.user.findUnique({ where: { id: adminId } });
    if (admin?.role !== UserRole.ADMIN) throw new ForbiddenException('عدم دسترسی');

    // در اینجا می‌توانید لاجیک ارسال نوتیفیکیشن رد شدن مدارک را هم اضافه کنید
    return this.prisma.user.update({
      where: { id: targetUserId },
      data: { status: UserStatus.INCOMPLETE, isVerified: false, bio: `رد هویت: ${reason}` }, // ذخیره موقت دلیل رد در بایو یا فیلد اختصاصی
    });
  }
}