import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import axios from 'axios';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async requestOtp(phone: string) {
    const code = Math.floor(10000 + Math.random() * 90000).toString();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 دقیقه اعتبار

    // پاک کردن کدهای قبلی و ایجاد کد جدید
    await this.prisma.otpCode.deleteMany({ where: { phone } });
    await this.prisma.otpCode.create({
      data: { phone, code, expiresAt, purpose: 'LOGIN' },
    });

    console.log(`🚀 OTP Code for ${phone}: ${code}`);

    try {
      // ارسال پیامک از طریق سامانه sms.ir
      await axios.post(
        'https://api.sms.ir/v1/send/verify',
        {
          mobile: phone,
          templateId: 591069, // کد قالب شما
          parameters: [{ name: 'CONTACTS', value: code }],
        },
        {
          headers: {
            'X-API-KEY': 'v0CQZ1eHgKedhRyBYIjHYhIsClPRW64esI8jRfuG6sDaMcNa',
          },
        },
      );

      return { success: true };
    } catch (error: any) {
      console.log(error);

      // در حالت توسعه، اگر پیامک ارسال نشد خطا نمی‌دهیم تا بتوان با کنسول تست کرد
      return { success: true, warning: 'SMS not sent, check console' };
    }
  }

  async verifyOtp(phone: string, code: string) {
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: { phone, code, expiresAt: { gt: new Date() } },
    });

    if (!otpRecord) {
      throw new BadRequestException('کد وارد شده اشتباه یا منقضی شده است');
    }

    // استفاده از تراکنش برای تضمین ساخته شدن همزمان کاربر و کیف پول
    const user = await this.prisma.$transaction(async (tx) => {
      let user = await tx.user.findUnique({ where: { phone } });

      if (!user) {
        user = await tx.user.create({
          data: {
            phone,
            status: 'INCOMPLETE',
          },
        });

        // ایجاد کیف پول بلافاصله بعد از ساخت کاربر
        await tx.wallet.create({
          data: { userId: user.id },
        });
      }

      return user;
    });

    // حذف کدهای OTP مصرف شده
    await this.prisma.otpCode.deleteMany({ where: { phone } });

    const payload = { sub: user.id, phone: user.phone };
    return {
      accessToken: this.jwtService.sign(payload),
      user: {
        id: user.id,
        status: user.status,
        phone: user.phone,
      },
    };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken);
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });
      if (!user) throw new UnauthorizedException();

      return {
        accessToken: this.jwtService.sign({ sub: user.id, phone: user.phone }),
      };
    } catch (e: any) {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
