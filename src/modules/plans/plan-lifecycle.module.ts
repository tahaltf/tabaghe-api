import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { PlanLifecycleService } from './plan-lifecycle.service';
import { PlanExpiryScheduler } from './plan-expiry.scheduler';

/**
 * جدا از PlansModule تا Auth/Users بدون وابستگی به Wallet
 * (جلوگیری از حلقه Auth → Plans → Wallet → Auth) بتوانند پلن اعطا کنند.
 */
@Module({
  imports: [NotificationModule],
  providers: [PlanLifecycleService, PlanExpiryScheduler],
  exports: [PlanLifecycleService],
})
export class PlanLifecycleModule {}
