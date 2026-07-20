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
import { SmsModule } from '../sms/sms.module';
import { SmsTemplateBootstrapService } from '../sms/sms-template-bootstrap.service';
import { PlanLifecycleModule } from '../plans/plan-lifecycle.module';
import { ReferralModule } from '../referral/referral.module';
import { PermissionsGuard } from './guards/permissions.guard';

@Module({
  imports: [
    NotificationModule,
    SmsModule,
    PlanLifecycleModule,
    ReferralModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: resolveJwtAccessSecret(config),
        signOptions: { expiresIn: '15m' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    OtpService,
    TokenService,
    JwtStrategy,
    SmsTemplateBootstrapService,
    GodadminBootstrapService,
    RegistrationPlanService,
    PermissionsGuard,
  ],
  exports: [AuthService, TokenService, OtpService, PermissionsGuard],
})
export class AuthModule {}
