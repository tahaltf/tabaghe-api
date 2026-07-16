import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { AdminUsersController } from './admin-users.controller';
import { UsersService } from './users.service';
import { AdminUsersService } from './admin-users.service';
import { NotificationModule } from '../notification/notification.module';
import { PlansModule } from '../plans/plans.module';

@Module({
  imports: [NotificationModule, PlansModule],
  controllers: [UsersController, AdminUsersController],
  providers: [UsersService, AdminUsersService],
  exports: [UsersService],
})
export class UsersModule {}
