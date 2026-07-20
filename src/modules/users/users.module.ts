import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleModule } from '../plans/plan-lifecycle.module';
import { ReferralModule } from '../referral/referral.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    NotificationModule,
    PlanLifecycleModule,
    ReferralModule,
    AuthModule,
  ],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AdminUsersService],
  exports: [UsersService],
})
export class UsersModule {}
