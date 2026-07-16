import { Injectable, Logger } from '@nestjs/common';
import { PlanLifecycleService } from '../../plans/plan-lifecycle.service';

/**
 * سازگاری با AuthModule — اعطای پلن پیش‌فرض ثبت‌نام.
 * منطق اصلی در PlanLifecycleService است.
 */
@Injectable()
export class RegistrationPlanService {
  private readonly logger = new Logger(RegistrationPlanService.name);

  constructor(private readonly planLifecycle: PlanLifecycleService) {}

  async assignDefaultPlan(userId: string): Promise<void> {
    try {
      await this.planLifecycle.assignDefaultRegistrationPlan(userId);
    } catch (err) {
      this.logger.warn(
        `assignDefaultPlan failed for ${userId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }
}
