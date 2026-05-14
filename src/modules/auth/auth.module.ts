import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { GodadminBootstrapService } from './services/godadmin-bootstrap.service';
import { NotificationModule } from '../notification/notification.module';
import { SmsService } from '../sms/sms.service';

@Module({
  imports: [
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:
          config.get<string>('JWT_SECRET') ?? 'fallback_access_secret_key',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    SmsService,
    GodadminBootstrapService,
  ],
  exports: [AuthService, TokenService],
})
export class AuthModule {}
