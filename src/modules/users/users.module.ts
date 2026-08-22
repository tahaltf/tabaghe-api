import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { AdminBankAccountsController } from './admin-bank-accounts.controller';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { UserPanelAccessService } from './user-panel-access.service';
import { UserPanelAccessGuard } from '../auth/guards/user-panel-access.guard';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleModule } from '../plans/plan-lifecycle.module';
import { ReferralModule } from '../referral/referral.module';
import { AuthModule } from '../auth/auth.module';
import { AiTokenModule } from '../ai-content/ai-token.module';
import { ZohalModule } from '../zohal/zohal.module';
import { BankAccountsService } from './bank-accounts.service';
import { FinancialVerificationService } from './financial-verification.service';

@Module({
  imports: [
    NotificationModule,
    PlanLifecycleModule,
    ReferralModule,
    AuthModule,
    AiTokenModule,
    ZohalModule,
  ],
  controllers: [UsersController, AdminUsersController, AdminBankAccountsController],
  providers: [
    UsersService,
    AdminUsersService,
    UserPanelAccessService,
    UserPanelAccessGuard,
    FinancialVerificationService,
    BankAccountsService,
  ],
  exports: [
    UsersService,
    UserPanelAccessService,
    UserPanelAccessGuard,
    FinancialVerificationService,
    BankAccountsService,
  ],
})
export class UsersModule {}
