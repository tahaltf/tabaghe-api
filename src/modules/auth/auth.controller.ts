import { Body, Controller, Post, HttpCode, HttpStatus } from '@nestjs/common';
import { AuthService } from './auth.service'; // تغییر نام از Auth به AuthService
import { RequestOtpDto, VerifyOtpDto } from './dto/otp.dto';
import { RefreshDto } from './dto/refresh.dto';
import { PasswordLoginDto } from './dto/password-login.dto';

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
  async request(@Body() dto: RequestOtpDto) {
    return this.authService.requestOtp(dto.phone);
  }


  @Post('verify')
  @HttpCode(HttpStatus.OK)
  async verify(@Body() dto: VerifyOtpDto) {
    return this.authService.verifyOtp(dto.phone, dto.code);
  }

  @Post('login-password')
  @HttpCode(HttpStatus.OK)
  async loginWithPassword(@Body() dto: PasswordLoginDto) {
    return this.authService.loginWithPassword(dto.username, dto.password);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Body() dto: RefreshDto) {
    return this.authService.refresh(dto.refreshToken);
  }
}