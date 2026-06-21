import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service'; // تغییر نام از Auth به AuthService
import { RequestOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { PasswordLoginDto } from './dto/password-login.dto';
import { AdminVerifyOtpDto } from './dto/admin-verify-otp.dto';

@Controller('auth')
export class AuthController {
  // تزریق سرویس با نام جدید
  constructor(private readonly authService: AuthService) {}

  /**
   * مرحله اول: درخواست کد تایید
   * سیستم بررسی می‌کند اگر فاصله زمانی رعایت شده باشد، پیامک ارسال می‌کند.
   */
  @Post('request')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async request(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phone);
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.code);
  }

  /** مرحله ۱ ورود ادمین — پس از تایید رمز، OTP به موبایل ادمین ارسال می‌شود */
  @Post('login-password')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async loginWithPassword(@Body() dto: PasswordLoginDto) {
    return this.authService.requestAdminPasswordLogin(
      dto.username,
      dto.password,
    );
  }

  /** مرحله ۲ ورود ادمین — تایید کد پیامکی */
  @Post('admin/verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyAdminLoginOtp(@Body() dto: AdminVerifyOtpDto) {
    return this.authService.verifyAdminLoginOtp(
      dto.challengeToken,
      dto.code,
    );
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }
}
