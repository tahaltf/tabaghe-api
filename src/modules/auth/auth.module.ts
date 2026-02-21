import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { WalletModule } from '../wallet/wallet.module';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuthService } from './auth.service';
import { SmsService } from '../sms/sms.service';

@Module({
  imports: [
    JwtModule.register({
      global: true, // این باعث می‌شود JwtService در همه جا در دسترس باشد
      secret: process.env.JWT_SECRET || 'fallback_secret_key', // خواندن از فایل env
      signOptions: { expiresIn: '7d' }, // اعتبار توکن ۷ روز
    }),
    UsersModule,
    WalletModule, // اضافه شد تا AuthService بتواند کیف پول بسازد
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    PrismaService, // اضافه شد چون در AuthService به آن نیاز داریم
    SmsService, // حتماً اضافه شود تا خطای Dependency حل شود
  ],
  exports: [AuthService], // اگر ماژول‌های دیگر نیاز به اعتبارسنجی توکن داشتند
})
export class AuthModule {}
