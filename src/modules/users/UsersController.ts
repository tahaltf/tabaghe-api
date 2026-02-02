import {
  Controller,
  Patch,
  Body,
  Req,
  UseGuards,
  Get,
  Header, // Header اضافه شد
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly prisma: PrismaService,
  ) {}

  // دریافت آمار پیشخوان با غیرفعال کردن کش برای رفع مشکل لودینگ فرانت
  @Get('dashboard-stats')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getDashboardStats(@Req() req: any) {
    const userId = req.user.id;

    const [
      wallet,
      activeAuctions,
      wonBids,
      exchangeOffersReceived,
      highestBidderCount,
      activeListings,
    ] = await Promise.all([
      // کیف پول و مبالغ
      this.prisma.wallet.findUnique({ where: { userId } }),

      // مزایده‌های فعال کاربر
      this.prisma.listingAuction.count({
        where: { listing: { authorId: userId }, status: 'ACTIVE' },
      }),

      // مزایده‌های برنده شده
      this.prisma.auctionBid.count({
        where: { bidderId: userId, status: 'WON' },
      }),

      // پیشنهادهای معاوضه دریافت شده برای آگهی‌های کاربر
      this.prisma.exchangeOffer.count({
        where: { listing: { authorId: userId }, status: 'PENDING' },
      }),

      // تعداد مزایده‌هایی که کاربر فعلاً نفر اول آن‌هاست
      this.prisma.listingAuction.count({
        where: { highestBidderId: userId, status: 'ACTIVE' },
      }),

      // تعداد آگهی‌های تایید شده و فعال کاربر
      this.prisma.listing.count({
        where: { authorId: userId, status: 'APPROVED' },
      }),
    ]);

    return {
      balanceAvailable: wallet?.balanceAvailable || 0,
      balanceBlocked: wallet?.balanceBlocked || 0,
      activeAuctions,
      wonBids,
      exchangeOffersReceived,
      highestBidderCount,
      activeListings,
      remainingQuota: 10 - activeListings,
    };
  }

  @Patch('complete-profile')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', {
      storage: diskStorage({
        destination: './uploads/national-cards',
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          callback(null, `card-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async completeProfile(
    @Req() req: any,
    @UploadedFile() file: any,
    @Body() body: any,
  ) {
    if (!file) throw new BadRequestException('تصویر کارت ملی الزامی است');

    return this.usersService.completeProfile(req.user.id, {
      firstName: body.firstName,
      lastName: body.lastName,
      nationalCode: body.nationalCode,
      nationalCardImage: file.path,
    });
  }
  @Patch('settings')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', {
      storage: diskStorage({
        destination: './uploads/national-cards',
        filename: (req, file, callback) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          callback(null, `card-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async updateSettings(
    @Req() req: any,
    @Body() dto: UpdateSettingsDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    const data = { ...dto };
    if (file) {
      data.nationalCardImage = file.path; // ذخیره آدرس فایل آپلود شده
    }
    return this.usersService.updateSettings(req.user.id, data);
  }

  // اضافه کردن متد GET برای لود اولیه تنظیمات
  @Get('me')
  async getMe(@Req() req: any) {
    return this.prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true,
        phone: true, // موبایل همیشه پر هست و از اینجا میاد
        email: true,
        firstName: true,
        lastName: true,
        nationalCardImage: true,
        avatar: true,
        bio: true,
        notifyEmail: true,
        notifySms: true,
        notifyPush: true,
      },
    });
  }
}
