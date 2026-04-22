import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionStatus,
  ExchangeOfferStatus,
  ListingStatus,
  Prisma,
  UserStatus,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

const MY_PROFILE_SELECT = {
  id: true,
  phone: true,
  email: true,
  firstName: true,
  lastName: true,
  nationalCode: true,
  shabaNumber: true,
  nationalCardImage: true,
  avatar: true,
  bio: true,
  notifyEmail: true,
  notifySms: true,
  notifyPush: true,
  status: true,
  role: true,
  isVerified: true,
  kycRejectionReason: true,
  kycReviewedAt: true,
} satisfies Prisma.UserSelect;

export type MyProfile = Prisma.UserGetPayload<{ select: typeof MY_PROFILE_SELECT }>;

export interface DashboardStats {
  activeAuctions: number;
  highestBidderCount: number;
  wonBids: number;
  exchangeOffersReceived: number;
  balanceBlocked: Prisma.Decimal | number;
  balanceAvailable: Prisma.Decimal | number;
  activeListings: number;
  remainingQuota: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string): Promise<MyProfile> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: MY_PROFILE_SELECT,
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
    return user;
  }

  async getDashboardStats(userId: string): Promise<DashboardStats> {
    const [activeBids, finishedBids, exchangeOffersReceived, activeListings, wallet] =
      await Promise.all([
        this.prisma.auctionBid.findMany({
          where: { bidderId: userId, auction: { status: AuctionStatus.ACTIVE } },
          distinct: ['listingId'],
          include: {
            auction: { include: { bids: { orderBy: { amount: 'desc' }, take: 1 } } },
          },
        }),
        this.prisma.auctionBid.findMany({
          where: { bidderId: userId, auction: { status: AuctionStatus.FINISHED } },
          distinct: ['listingId'],
          include: {
            auction: { include: { bids: { orderBy: { amount: 'desc' }, take: 1 } } },
          },
        }),
        this.prisma.exchangeOffer.count({
          where: {
            listing: { authorId: userId },
            status: ExchangeOfferStatus.PENDING,
          },
        }),
        this.prisma.listing.count({
          where: { authorId: userId, status: ListingStatus.APPROVED },
        }),
        this.prisma.wallet.findUnique({ where: { userId } }),
      ]);

    const highestBidderCount = activeBids.reduce((acc, bid) => {
      const topBid = bid.auction?.bids[0];
      return topBid && topBid.bidderId === userId ? acc + 1 : acc;
    }, 0);

    const wonBidsCount = finishedBids.reduce(
      (acc, bid) =>
        bid.auction?.bids[0]?.bidderId === userId ? acc + 1 : acc,
      0,
    );

    return {
      activeAuctions: activeBids.length,
      highestBidderCount,
      wonBids: wonBidsCount,
      exchangeOffersReceived,
      balanceBlocked: wallet?.balanceBlocked ?? 0,
      balanceAvailable: wallet?.balanceAvailable ?? 0,
      activeListings,
      remainingQuota: Math.max(0, 10 - activeListings),
    };
  }

  async completeProfile(
    userId: string,
    dto: CompleteProfileDto,
    nationalCardImageFilename: string,
  ): Promise<MyProfile> {
    const duplicate = await this.prisma.user.findFirst({
      where: { nationalCode: dto.nationalCode, NOT: { id: userId } },
      select: { id: true },
    });
    if (duplicate) {
      throw new BadRequestException('این کد ملی قبلاً در سیستم ثبت شده است.');
    }

    const cleanShaba = dto.shabaNumber.replace(/^IR/i, '').trim();
    if (cleanShaba.length !== 24) {
      throw new BadRequestException('شماره شبا باید ۲۴ رقم باشد.');
    }

    return this.prisma.user.update({
      where: { id: userId },
      data: {
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalCode: dto.nationalCode,
        shabaNumber: cleanShaba,
        nationalCardImage: nationalCardImageFilename,
        status: UserStatus.PENDING,
      },
      select: MY_PROFILE_SELECT,
    });
  }

  async updateSettings(
    userId: string,
    dto: UpdateSettingsDto,
    nationalCardImageFilename?: string,
  ): Promise<MyProfile> {
    const data: Prisma.UserUpdateInput = {
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email,
      bio: dto.bio,
      avatar: dto.avatar,
      notifyEmail: this.toBool(dto.notifyEmail),
      notifySms: this.toBool(dto.notifySms),
      notifyPush: this.toBool(dto.notifyPush),
    };

    if (nationalCardImageFilename) {
      data.nationalCardImage = nationalCardImageFilename;
      data.status = UserStatus.PENDING;
    }

    try {
      return await this.prisma.user.update({
        where: { id: userId },
        data,
        select: MY_PROFILE_SELECT,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new BadRequestException('این ایمیل قبلاً ثبت شده است.');
      }
      throw err;
    }
  }

  private toBool(value: boolean | string | undefined): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  }
}
