import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleModule } from './plan-lifecycle.module';

@Module({
  providers: [PlansService],
  controllers: [PlansController],
  imports: [WalletModule, NotificationModule, PlanLifecycleModule],
  exports: [PlansService, PlanLifecycleModule],
})
export class PlansModule {}
