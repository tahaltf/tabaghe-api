import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { QuotaAction, QuotaReason } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BUILTIN_FREE_PLAN_ID } from '../../plans/builtin-free-plan-display';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class RegistrationPlanService {
  private readonly logger = new Logger(RegistrationPlanService.name);

  constructor(private readonly prisma: PrismaService) {}

  async assignDefaultPlan(userId: string): Promise<void> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'DEFAULT_REGISTRATION_PLAN_ID' },
    });
    const planId = row?.value?.trim();
    if (!planId || planId === BUILTIN_FREE_PLAN_ID) return;

    const existing = await this.prisma.userPlanPurchase.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (existing) return;

    try {
      await this.grantPlan(userId, planId, 'پلن پیش‌فرض ثبت‌نام');
    } catch (err) {
      this.logger.warn(
        `assignDefaultPlan failed for ${userId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  private async grantPlan(userId: string, planId: string, note: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });
      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      await tx.userPlanPurchase.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'CANCELLED' },
      });

      const durationDays = Math.max(1, plan.durationDays ?? 365);
      const expiresAt = addDaysUtc(new Date(), durationDays);

      const purchase = await tx.userPlanPurchase.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
          expiresAt,
        },
      });

      for (const rule of plan.rules) {
        const quotaEntries = Array.from({ length: rule.count }).map(() => ({
          userId,
          planPurchaseId: purchase.id,
          listingType: rule.type,
          action: QuotaAction.RELEASE,
          reason: QuotaReason.PLAN,
          note,
        }));
        if (quotaEntries.length > 0) {
          await tx.quotaLedger.createMany({ data: quotaEntries });
        }
      }

      return purchase;
    });
  }
}
