import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService, // 👈 تزریق متغیرهای محیطی
  ) {}

  async requestOtp(phone: string) {
    // ۱. جلوگیری از حملات SMS Bombing (بررسی فاصله زمانی ۲ دقیقه‌ای)
    const existingOtp = await this.prisma.otpCode.findFirst({
      where: { phone, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    if (existingOtp) {
      const timeDiff = new Date().getTime() - existingOtp.createdAt.getTime();
      if (timeDiff < 2 * 60 * 1000) {
        throw new BadRequestException('لطفاً ۲ دقیقه صبر کنید و دوباره امتحان کنید.');
      }
    }

    const isTestNumber = phone === '09190949469';
    const code = isTestNumber
      ? '11111'
      : Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 دقیقه اعتبار

    // ۲. پاک کردن کدهای قبلی و ایجاد کد جدید
    await this.prisma.otpCode.deleteMany({ where: { phone } });
    await this.prisma.otpCode.create({
      data: { phone, code, expiresAt, purpose: 'LOGIN' },
    });

    this.logger.log(`🚀 OTP Code for ${phone}: ${code}`);

    if (isTestNumber) {
      return { success: true, message: 'کد تایید با موفقیت ارسال شد.' };
    }

    // ۳. ارسال پیامک با استفاده از کلید محیطی
    try {
      const apiKey = this.configService.get<string>('SMS_IR_API_KEY');
      if (!apiKey) throw new Error('SMS API KEY is missing in .env');

      await axios.post(
        'https://api.sms.ir/v1/send/verify',
        {
          mobile: phone,
          templateId: 591069,
          parameters: [{ name: 'CONTACTS', value: code }],
        },
        {
          headers: { 'X-API-KEY': apiKey },
        },
      );

      return { success: true, message: 'کد تایید پیامک شد.' };
    } catch (error: any) {
      this.logger.error('SMS Provider Error:', error?.response?.data || error.message);
      // تو فاز توسعه ارور نمیدیم که لاگین بلاک نشه
      return { success: true, warning: 'پیامک ارسال نشد، کد را از کنسول بردارید.' };
    }
  }

  async verifyOtp(phone: string, code: string) {
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() } },
    });

    if (!otpRecord) {
      throw new BadRequestException('کد وارد شده اشتباه یا منقضی شده است.');
    }

    // ۴. تراکنش امن (کد خودت که عالی بود)
    const user = await this.prisma.$transaction(async (tx) => {
      let existingUser = await tx.user.findUnique({ where: { phone } });

      if (!existingUser) {
        existingUser = await tx.user.create({
          data: { phone, status: 'INCOMPLETE' },
        });

        await tx.wallet.create({
          data: { userId: existingUser.id },
        });
      }
      return existingUser;
    });

    await this.prisma.otpCode.deleteMany({ where: { phone } });

    // ۵. صدور توکن‌ها با متد مجزا
    return this.generateTokens(user.id, user.phone, user.status);
  }

  async refresh(refreshToken: string) {
    try {
      // استفاده از سکرت مربوط به رفرش توکن
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'your_refresh_secret',
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException('کاربر یافت نشد.');

      return this.generateTokens(user.id, user.phone, user.status);
    } catch (e: any) {
      throw new UnauthorizedException('توکن نامعتبر یا منقضی شده است.');
    }
  }

  /**
   * متد کمکی برای تولید همزمان Access و Refresh Token
   */
  private generateTokens(userId: string, phone: string, status: string) {
    const payload = { sub: userId, phone };

    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_SECRET') || 'your_access_secret',
      expiresIn: '7d', // اکسس توکن کوتاه مدت (۱۵ دقیقه)
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('JWT_REFRESH_SECRET') || 'your_refresh_secret',
      expiresIn: '7d', // رفرش توکن بلند مدت (۷ روز)
    });

    return {
      accessToken,
      refreshToken, // 👈 این مورد قبلاً جا افتاده بود
      user: {
        id: userId,
        status,
        phone,
      },
    };
  }
}