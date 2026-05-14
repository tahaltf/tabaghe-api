import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ListingType, QuotaAction, QuotaReason } from '@prisma/client';
import {
  BUILTIN_FREE_PLAN_ID,
  buildBuiltinFreePlan,
} from './builtin-free-plan';

function addDaysUtc(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // تغییر نام برای هماهنگی با Controller
  async getActivePlans() {
    const freeDirectLimitSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'FREE_DIRECT_QUOTA' },
    });
    const rawFree = freeDirectLimitSetting
      ? Number(freeDirectLimitSetting.value)
      : 2;
    const freeDirectLimit = Number.isFinite(rawFree)
      ? Math.max(0, Math.floor(rawFree))
      : 2;
    const builtin = buildBuiltinFreePlan(freeDirectLimit);

    try {
      const dbPlans = await this.prisma.plan.findMany({
        where: { isActive: true },
        select: {
          id: true,
          title: true,
          description: true,
          price: true,
          isActive: true,
          durationDays: true,
          feeDiscountDirectPercent: true,
          feeDiscountAuctionPercent: true,
          createdAt: true,
          updatedAt: true,
          rules: {
            select: { id: true, planId: true, type: true, count: true },
            orderBy: { type: 'asc' },
          },
        },
        orderBy: { price: 'asc' },
      });

      return [
        this.toPublicBuiltinPlan(builtin),
        ...dbPlans.map((p) => this.toPublicDbPlan(p)),
      ];
    } catch (err) {
      this.logger.error('getActivePlans failed', err);
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        (err.code === 'P2021' ||
          err.code === 'P2022' ||
          err.message?.includes('does not exist'))
      ) {
        throw new ServiceUnavailableException(
          'جدول یا ستون پلن در دیتابیس با Prisma هم‌خوان نیست. روی سرور `npx prisma migrate deploy` را اجرا کنید.',
        );
      }
      throw err;
    }
  }

  private toPublicBuiltinPlan(
    builtin: ReturnType<typeof buildBuiltinFreePlan>,
  ) {
    return {
      ...builtin,
      createdAt: builtin.createdAt.toISOString(),
      updatedAt: builtin.updatedAt.toISOString(),
    };
  }

  private toPublicDbPlan(
    plan: Prisma.PlanGetPayload<{
      select: {
        id: true;
        title: true;
        description: true;
        price: true;
        isActive: true;
        durationDays: true;
        feeDiscountDirectPercent: true;
        feeDiscountAuctionPercent: true;
        createdAt: true;
        updatedAt: true;
        rules: {
          select: { id: true; planId: true; type: true; count: true };
        };
      };
    }>,
  ) {
    return {
      id: plan.id,
      title: plan.title,
      description: plan.description,
      price: plan.price,
      isActive: plan.isActive,
      isBuiltinFree: false as const,
      durationDays: plan.durationDays,
      feeDiscountDirectPercent: plan.feeDiscountDirectPercent,
      feeDiscountAuctionPercent: plan.feeDiscountAuctionPercent,
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
      rules: plan.rules.map((r) => ({
        id: r.id,
        planId: r.planId,
        type: r.type,
        count: r.count,
      })),
    };
  }

  async buyPlan(userId: string, planId: string) {
    if (planId === BUILTIN_FREE_PLAN_ID) {
      throw new BadRequestException(
        'پلن رایگان برای همه فعال است و نیازی به خرید ندارد.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });

      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      const price = Number(plan.price);
      if (price > 0) {
        await this.walletService.payFromAvailable(
          userId,
          plan.price,
          planId,
          tx,
        );
      }

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

      // اضافه کردن سهمیه به لجر
      // چون فیلد count در لجر نداریم، به تعداد rule.count ردیف ایجاد می‌کنیم
      for (const rule of plan.rules) {
        const quotaEntries = Array.from({ length: rule.count }).map(() => ({
          userId,
          planPurchaseId: purchase.id,
          listingType: rule.type,
          action: QuotaAction.RELEASE, // آزاد کردن سهمیه برای کاربر
          reason: QuotaReason.PLAN,
          note: `خرید پلن: ${plan.title}`,
        }));

        await tx.quotaLedger.createMany({
          data: quotaEntries,
        });
      }

      return purchase;
    });
  }

  /**
   * خلاصه خریدها و سهمیه‌ی باقی‌مانده کاربر برای نمایش در پنل خرید پلن.
   */
  async getMySummary(userId: string) {
    const purchases = await this.prisma.userPlanPurchase.findMany({
      where: { userId },
      include: { plan: { include: { rules: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();

    const remainingByType: Record<ListingType, number> = {
      DIRECT: 0,
      AUCTION: 0,
      EXCHANGE: 0,
    };

    const purchaseIds = purchases.map((p) => p.id);
    const commitByPurchaseAndType = new Map<string, number>();

    if (purchaseIds.length > 0) {
      const commitGroups = await this.prisma.quotaLedger.groupBy({
        by: ['planPurchaseId', 'listingType'],
        where: {
          planPurchaseId: { in: purchaseIds },
          action: QuotaAction.COMMIT,
        },
        _count: { _all: true },
      });
      for (const row of commitGroups) {
        if (row.planPurchaseId) {
          commitByPurchaseAndType.set(
            `${row.planPurchaseId}:${row.listingType}`,
            row._count._all,
          );
        }
      }
    }

    for (const p of purchases) {
      if (!p.plan) continue;
      if (p.status !== 'ACTIVE') continue;
      const rules = p.plan.rules ?? [];
      const duration = Math.max(1, p.plan.durationDays ?? 365);
      const expiresAt = p.expiresAt ?? addDaysUtc(p.createdAt, duration);
      if (expiresAt.getTime() <= now.getTime()) {
        continue;
      }
      for (const rule of rules) {
        const used = commitByPurchaseAndType.get(`${p.id}:${rule.type}`) ?? 0;
        const left = Math.max(0, rule.count - used);
        remainingByType[rule.type] = (remainingByType[rule.type] ?? 0) + left;
      }
    }

    const freeDirectLimitSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'FREE_DIRECT_QUOTA' },
    });
    const rawFreeLimit = freeDirectLimitSetting
      ? Number(freeDirectLimitSetting.value)
      : 2;
    const freeDirectLimit = Number.isFinite(rawFreeLimit)
      ? Math.max(0, Math.floor(rawFreeLimit))
      : 2;

    const [commits, releases] = await Promise.all([
      this.prisma.quotaLedger.count({
        where: {
          userId,
          listingType: ListingType.DIRECT,
          reason: QuotaReason.FREE_DIRECT,
          action: QuotaAction.COMMIT,
        },
      }),
      this.prisma.quotaLedger.count({
        where: {
          userId,
          listingType: ListingType.DIRECT,
          reason: QuotaReason.FREE_DIRECT,
          action: QuotaAction.RELEASE,
        },
      }),
    ]);
    const freeDirectRemaining = Math.max(
      0,
      freeDirectLimit - (commits - releases),
    );

    const purchasesView = purchases.map((p) => {
      if (!p.plan) {
        const subscriptionExpiresAt = p.expiresAt ?? p.createdAt;
        const ms = subscriptionExpiresAt.getTime() - now.getTime();
        return {
          ...p,
          plan: {
            id: '',
            title: 'پلن (نامشخص)',
            description: null as string | null,
            price: 0,
            isActive: false,
            rules: [] as {
              id: string;
              planId: string;
              type: ListingType;
              count: number;
            }[],
            createdAt: p.createdAt,
            updatedAt: p.createdAt,
            durationDays: 0,
            feeDiscountDirectPercent: 0,
            feeDiscountAuctionPercent: 0,
          },
          subscriptionExpiresAt,
          subscriptionDaysRemaining: Math.max(0, Math.ceil(ms / 86400000)),
          subscriptionActive: false,
        };
      }
      const duration = Math.max(1, p.plan.durationDays ?? 365);
      const subscriptionExpiresAt =
        p.expiresAt ?? addDaysUtc(p.createdAt, duration);
      const ms = subscriptionExpiresAt.getTime() - now.getTime();
      const subscriptionDaysRemaining = Math.max(0, Math.ceil(ms / 86400000));
      const subscriptionActive =
        p.status === 'ACTIVE' &&
        subscriptionExpiresAt.getTime() > now.getTime();
      return {
        ...p,
        subscriptionExpiresAt,
        subscriptionDaysRemaining,
        subscriptionActive,
      };
    });

    return {
      purchases: purchasesView,
      remainingByType,
      freeDirectLimit,
      freeDirectRemaining,
    };
  }
}
