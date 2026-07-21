import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { UserPanelAccessService } from './user-panel-access.service';
import { UserPanelAccessGuard } from '../auth/guards/user-panel-access.guard';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleModule } from '../plans/plan-lifecycle.module';
import { ReferralModule } from '../referral/referral.module';
import { AuthModule } from '../auth/auth.module';
import { AiTokenModule } from '../ai-content/ai-token.module';

@Module({
  imports: [
    NotificationModule,
    PlanLifecycleModule,
    ReferralModule,
    AuthModule,
    AiTokenModule,
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AdminUsersService, UserPanelAccessService, UserPanelAccessGuard],
  exports: [UsersService, UserPanelAccessService, UserPanelAccessGuard],
})
export class UsersModule {}
