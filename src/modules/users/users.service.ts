import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UserStatus, AuctionStatus, ListingStatus, ExchangeOfferStatus } from '@prisma/client';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  // ... (متدهای getMe, completeProfile, updateSettings بدون تغییر می‌مانند) ...
  // برای خلاصه شدن، فقط متد getDashboardStats که ارور داشت را اینجا می‌نویسم:

  async getDashboardStats(userId: string) {
    // ====================================================
    // 1. دریافت بیدهای فعال (برای محاسبه مبلغ بلوکه و نفر اول بودن)
    // ====================================================
    const activeBids = await this.prisma.auctionBid.findMany({
      where: {
        bidderId: userId,
        // ✅ اصلاح نام رابطه به 'auction' و وضعیت به 'ACTIVE'
        auction: { status: AuctionStatus.ACTIVE },
      },
      distinct: ['listingId'],
      include: {
        // ✅ اصلاح نام رابطه به 'auction'
        auction: {
          include: {
            // دریافت بالاترین پیشنهاد
            bids: { orderBy: { amount: 'desc' }, take: 1 },
          },
        },
      },
    });

    let highestBidderCount = 0;
    let balanceBlocked = 0;

    for (const bid of activeBids) {
      balanceBlocked += Number(bid.amount);

      // ✅ اصلاح دسترسی به 'auction'
      const topBid = bid.auction?.bids[0];
      if (topBid && topBid.bidderId === userId) {
        highestBidderCount++;
      }
    }

    // ====================================================
    // 2. محاسبه برده‌ها (Won Bids)
    // ====================================================
    // چون winnerId نداریم، باید مزایده‌های تمام شده کاربر را بگیریم و چک کنیم
    const finishedBids = await this.prisma.auctionBid.findMany({
      where: {
        bidderId: userId,
        // ✅ وضعیت 'FINISHED' صحیح است (نه CLOSED)
        auction: { status: AuctionStatus.FINISHED },
      },
      distinct: ['listingId'],
      include: {
        auction: {
          include: {
            bids: { orderBy: { amount: 'desc' }, take: 1 },
          },
        },
      },
    });

    let wonBidsCount = 0;
    for (const bid of finishedBids) {
      // اگر بالاترین پیشنهاد مزایده تمام شده مال من باشد = برنده
      if (bid.auction?.bids[0]?.bidderId === userId) {
        wonBidsCount++;
      }
    }

    // ====================================================
    // 3. سایر آمارها
    // ====================================================
    const exchangeOffersReceived = await this.prisma.exchangeOffer.count({
      where: {
        listing: { authorId: userId },
        status: ExchangeOfferStatus.PENDING,
      },
    });

    const activeListings = await this.prisma.listing.count({
      where: {
        authorId: userId,
        // ✅ وضعیت 'APPROVED' صحیح است (نه ACTIVE)
        status: ListingStatus.APPROVED,
      },
    });

    // دریافت کیف پول (اختیاری)
    const wallet = await this.prisma.wallet.findUnique({
      where: { userId },
    });

    return {
      activeAuctions: activeBids.length,
      highestBidderCount,
      wonBids: wonBidsCount,
      exchangeOffersReceived,
      balanceBlocked: wallet?.balanceBlocked || balanceBlocked,
      balanceAvailable: wallet?.balanceAvailable || 0,
      activeListings,
      remainingQuota: Math.max(0, 10 - activeListings),
    };
  }

  // متدهای قبلی (برای کپی کردن راحت‌تر شما، اینجا هم میگذارم)
  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, phone: true, email: true, firstName: true, lastName: true,
        nationalCardImage: true, avatar: true, bio: true,
        notifyEmail: true, notifySms: true, notifyPush: true, status: true,
      },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return { data: user };
  }

  async completeProfile(userId: string, data: any) {
    const existingUser = await this.prisma.user.findFirst({
      where: { nationalCode: data.nationalCode, NOT: { id: userId } },
    });
    if (existingUser) throw new BadRequestException('کد ملی تکراری است.');
    return this.prisma.user.update({
      where: { id: userId },
      data: { ...data, status: UserStatus.PENDING },
    });
  }

  async updateSettings(userId: string, dto: UpdateSettingsDto) {
    try {
      const updateData: any = {
        firstName: dto.firstName, lastName: dto.lastName, email: dto.email,
        bio: dto.bio, avatar: dto.avatar,
        notifyEmail: String(dto.notifyEmail) === 'true',
        notifySms: String(dto.notifySms) === 'true',
        notifyPush: String(dto.notifyPush) === 'true',
      };
      if (dto.nationalCardImage) updateData.nationalCardImage = dto.nationalCardImage;

      return await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: { id: true, email: true, firstName: true, lastName: true, avatar: true }
      });
    } catch (error) {
      if (error.code === 'P2002') throw new BadRequestException('ایمیل تکراری است.');
      throw error;
    }
  }
}