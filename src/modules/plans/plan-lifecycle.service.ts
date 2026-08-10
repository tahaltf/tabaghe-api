import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, QuotaAction, QuotaReason } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from '../notification/notification.service';
import { BUILTIN_FREE_PLAN_ID } from './builtin-free-plan-display';
import { AiTokenService } from '../ai-content/services/ai-token.service';

export const DEFAULT_REGISTRATION_PLAN_SETTING_KEY = 'DEFAULT_REGISTRATION_PLAN_ID';
export const KYC_APPROVAL_PLAN_SETTING_KEY = 'KYC_APPROVAL_PLAN_ID';

export type PlanChangeKind =
  | 'ADMIN_ASSIGN'
  | 'ADMIN_CANCEL'
  | 'PURCHASE'
  | 'REGISTRATION'
  | 'KYC_GIFT'
  | 'EXPIRED';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function changeKindLabelFa(kind: PlanChangeKind): string {
  switch (kind) {
    case 'ADMIN_ASSIGN':
      return 'انتساب توسط پشتیبانی';
    case 'ADMIN_CANCEL':
      return 'لغو توسط پشتیبانی';
    case 'PURCHASE':
      return 'خرید پلن';
    case 'REGISTRATION':
      return 'پلن هدیه ثبت‌نام';
    case 'KYC_GIFT':
      return 'پلن هدیه پس از احراز هویت';
    case 'EXPIRED':
      return 'پایان مهلت پلن';
    default:
      return 'تغییر پلن';
  }
}

@Injectable()
export class PlanLifecycleService {
  private readonly logger = new Logger(PlanLifecycleService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly aiTokens: AiTokenService,
  ) {}

  /**
   * لغو پلن‌های ACTIVE و اعطای پلن جدید (بدون کسر کیف پول).
   */
  async grantReplacingActive(
    userId: string,
    planId: string,
    note: string,
  ): Promise<{
    id: string;
    planId: string;
    planTitle: string;
    expiresAt: Date | null;
    previousPlanTitle: string | null;
  }> {
    if (!planId || planId === BUILTIN_FREE_PLAN_ID) {
      throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });
      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      const previous = await tx.userPlanPurchase.findFirst({
        where: { userId, status: 'ACTIVE' },
        include: { plan: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      });

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

      await this.aiTokens.resetPlanTokens(
        userId,
        Math.max(0, plan.aiTokensPerMonth ?? 0),
        purchase.id,
        tx,
      );

      return {
        id: purchase.id,
        planId: purchase.planId,
        planTitle: plan.title,
        expiresAt: purchase.expiresAt,
        previousPlanTitle: previous?.plan?.title ?? null,
      };
    });
  }

  async assignFromSetting(
    userId: string,
    settingKey: string,
    kind: Extract<PlanChangeKind, 'REGISTRATION' | 'KYC_GIFT'>,
    note: string,
  ): Promise<boolean> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: settingKey },
    });
    const planId = row?.value?.trim();
    if (!planId || planId === BUILTIN_FREE_PLAN_ID) return false;

    try {
      const granted = await this.grantReplacingActive(userId, planId, note);
      await this.notifyPlanChange({
        userId,
        kind,
        planTitle: granted.planTitle,
        previousPlanTitle: granted.previousPlanTitle,
        expiresAt: granted.expiresAt,
      });
      return true;
    } catch (err) {
      this.logger.warn(
        `assignFromSetting(${settingKey}) failed for ${userId}: ${String((err as Error)?.message ?? err)}`,
      );
      return false;
    }
  }

  async assignDefaultRegistrationPlan(userId: string): Promise<void> {
    const existing = await this.prisma.userPlanPurchase.findFirst({
      where: { userId, status: 'ACTIVE' },
    });
    if (existing) return;

    await this.assignFromSetting(
      userId,
      DEFAULT_REGISTRATION_PLAN_SETTING_KEY,
      'REGISTRATION',
      'پلن پیش‌فرض ثبت‌نام',
    );
  }

  async assignKycGiftPlan(userId: string): Promise<void> {
    await this.assignFromSetting(
      userId,
      KYC_APPROVAL_PLAN_SETTING_KEY,
      'KYC_GIFT',
      'پلن هدیه پس از تایید احراز هویت',
    );
  }

  async notifyPlanChange(params: {
    userId: string;
    kind: PlanChangeKind;
    planTitle?: string | null;
    previousPlanTitle?: string | null;
    expiresAt?: Date | null;
    remainingActivePlanTitle?: string | null;
  }): Promise<void> {
    const {
      userId,
      kind,
      planTitle,
      previousPlanTitle,
      expiresAt,
      remainingActivePlanTitle,
    } = params;

    const reasonFa = changeKindLabelFa(kind);
    const titlePlan = (planTitle ?? '').trim() || 'پلن';
    const prev = (previousPlanTitle ?? '').trim();
    const remaining = (remainingActivePlanTitle ?? '').trim();

    let type: NotificationType = NotificationType.PLAN_CHANGED;
    let title = 'تغییر پلن';
    let message = '';

    switch (kind) {
      case 'ADMIN_ASSIGN':
        title = 'پلن شما به‌روز شد';
        message = prev
          ? `پلن «${prev}» لغو و پلن «${titlePlan}» توسط پشتیبانی برای شما فعال شد.`
          : `پلن «${titlePlan}» توسط پشتیبانی برای شما فعال شد.`;
        break;
      case 'ADMIN_CANCEL':
        title = 'پلن شما لغو شد';
        message = remaining
          ? `پلن فعال شما لغو شد. هم‌اکنون پلن «${remaining}» برای شما فعال است.`
          : `پلن فعال شما لغو شد و به سهمیه پایه برگشتید.`;
        break;
      case 'PURCHASE':
        title = 'خرید پلن موفق';
        message = `پلن «${titlePlan}» با موفقیت برای شما فعال شد.`;
        break;
      case 'REGISTRATION':
        title = 'پلن هدیه ثبت‌نام';
        message = `به مناسبت ثبت‌نام، پلن «${titlePlan}» برای شما فعال شد.`;
        break;
      case 'KYC_GIFT':
        title = 'پلن هدیه احراز هویت';
        message = prev
          ? `پس از تایید احراز هویت، پلن «${prev}» با پلن هدیه «${titlePlan}» جایگزین شد.`
          : `پس از تایید احراز هویت، پلن هدیه «${titlePlan}» برای شما فعال شد.`;
        break;
      case 'EXPIRED':
        type = NotificationType.PLAN_EXPIRED;
        title = 'مهلت پلن به پایان رسید';
        message = remaining
          ? `مهلت پلن «${titlePlan}» تمام شد. هم‌اکنون پلن «${remaining}» برای شما فعال است.`
          : `مهلت پلن «${titlePlan}» تمام شد و به سهمیه پایه برگشتید.`;
        break;
    }

    try {
      await this.notificationService.create({
        userId,
        type,
        title,
        message,
        meta: {
          planTitle: titlePlan,
          previousPlanTitle: prev || undefined,
          remainingActivePlanTitle: remaining || undefined,
          changeKind: kind,
          reasonFa,
          expiresAt: expiresAt?.toISOString(),
          url: '/dashboard/plans',
        },
      });
    } catch (err) {
      this.logger.warn(
        `notifyPlanChange(${kind}) failed for ${userId}: ${String((err as Error)?.message ?? err)}`,
      );
    }
  }

  /**
   * پس از لغو/انقضای یک خرید، توکن پلن را با پلن ACTIVE باقی‌مانده هم‌تراز می‌کند.
   * اگر چیزی نمانده باشد، توکن پلن سوزانده می‌شود (برگشت به پلن پایه).
   */
  async syncAiPlanTokensForUser(
    userId: string,
    now: Date = new Date(),
  ): Promise<void> {
    const remaining = await this.prisma.userPlanPurchase.findFirst({
      where: {
        userId,
        status: 'ACTIVE',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        plan: { select: { aiTokensPerMonth: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const amount = Math.max(0, remaining?.plan?.aiTokensPerMonth ?? 0);
    if (!remaining || amount <= 0) {
      await this.aiTokens.expirePlanTokens(userId);
      return;
    }

    await this.aiTokens.resetPlanTokens(userId, amount, remaining.id);
  }

  /**
   * پلن‌های ACTIVE منقضی‌شده را لغو می‌کند و به کاربر اطلاع می‌دهد.
   * اعتبار باقی‌مانده‌ی خرید منقضی‌شده از بین می‌رود؛ اگر خرید ACTIVE دیگری
   * مانده باشد همان پلن تا پایان مهلتش فعال می‌ماند، وگرنه به پلن پایه برمی‌گردد.
   */
  async processExpiredPlans(): Promise<{ expired: number; notified: number }> {
    const now = new Date();
    const expired = await this.prisma.userPlanPurchase.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lte: now },
        expiryNotifiedAt: null,
      },
      include: {
        plan: { select: { title: true } },
      },
      take: 100,
      orderBy: { expiresAt: 'asc' },
    });

    let notified = 0;
    for (const purchase of expired) {
      await this.prisma.userPlanPurchase.update({
        where: { id: purchase.id },
        data: {
          status: 'CANCELLED',
          expiryNotifiedAt: now,
        },
      });

      const remaining = await this.prisma.userPlanPurchase.findFirst({
        where: {
          userId: purchase.userId,
          status: 'ACTIVE',
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: { plan: { select: { title: true } } },
        orderBy: { createdAt: 'desc' },
      });

      await this.notifyPlanChange({
        userId: purchase.userId,
        kind: 'EXPIRED',
        planTitle: purchase.plan?.title ?? 'پلن',
        remainingActivePlanTitle: remaining?.plan?.title ?? null,
      });
      await this.syncAiPlanTokensForUser(purchase.userId, now);
      notified += 1;
    }

    return { expired: expired.length, notified };
  }
}
