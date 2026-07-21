import { Module } from '@nestjs/common';
import { PlansService } from './plans.service';
import { PlansController } from './plans.controller';
import { WalletModule } from '../wallet/wallet.module';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleModule } from './plan-lifecycle.module';
import { AiTokenModule } from '../ai-content/ai-token.module';

@Module({
  providers: [PlansService],
  controllers: [PlansController],
  imports: [WalletModule, NotificationModule, PlanLifecycleModule, AiTokenModule],
  exports: [PlansService, PlanLifecycleModule],
})
export class PlansModule {}
