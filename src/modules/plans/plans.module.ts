import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleService } from './plan-lifecycle.service';
import { PlanExpiryScheduler } from './plan-expiry.scheduler';

@Module({
  providers: [PlansService, PlanLifecycleService, PlanExpiryScheduler],
  controllers: [PlansController],
  imports: [WalletModule, NotificationModule],
  exports: [PlansService, PlanLifecycleService],
})
export class PlansModule {}
