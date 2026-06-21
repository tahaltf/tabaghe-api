import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { resolveJwtAccessSecret } from '../../config/jwt-secrets.util';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { OtpService } from './services/otp.service';
import { TokenService } from './services/token.service';
import { GodadminBootstrapService } from './services/godadmin-bootstrap.service';
import { RegistrationPlanService } from './services/registration-plan.service';
import { NotificationModule } from '../notification/notification.module';
import { SmsService } from '../sms/sms.service';
import { SmsTemplateBootstrapService } from '../sms/sms-template-bootstrap.service';

@Module({
  imports: [
    NotificationModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtAccessSecret(config),
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
    SmsTemplateBootstrapService,
    GodadminBootstrapService,
    RegistrationPlanService,
  ],
  exports: [AuthService, TokenService, OtpService],
})
export class AuthModule {}
