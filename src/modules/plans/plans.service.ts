import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { ListingType, QuotaAction, QuotaReason } from '@prisma/client';

@Injectable()
export class PlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
  ) {}

  // تغییر نام برای هماهنگی با Controller
  async getActivePlans() {
    return this.prisma.plan.findMany({
      where: { isActive: true },
      include: { rules: true },
    });
  }

  async buyPlan(userId: string, planId: string) {
    return this.prisma.$transaction(async (tx) => {
      const plan = await tx.plan.findUnique({
        where: { id: planId },
        include: { rules: true },
      });

      if (!plan || !plan.isActive) {
        throw new NotFoundException('پلن مورد نظر یافت نشد یا غیرفعال است');
      }

      // کسر مبلغ از کیف پول
      await this.walletService.payFromAvailable(userId, plan.price, planId, tx);

      const purchase = await tx.userPlanPurchase.create({
        data: {
          userId,
          planId,
          status: 'ACTIVE',
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

    const remainingByType: Record<ListingType, number> = {
      DIRECT: 0,
      AUCTION: 0,
      EXCHANGE: 0,
    };

    for (const p of purchases) {
      if (p.status !== 'ACTIVE') continue;
      for (const rule of p.plan.rules) {
        const used = await this.prisma.quotaLedger.count({
          where: {
            planPurchaseId: p.id,
            listingType: rule.type,
            action: QuotaAction.COMMIT,
          },
        });
        const left = Math.max(0, rule.count - used);
        remainingByType[rule.type] = (remainingByType[rule.type] ?? 0) + left;
      }
    }

    const freeDirectLimitSetting = await this.prisma.systemSetting.findUnique({
      where: { key: 'FREE_DIRECT_QUOTA' },
    });
    const freeDirectLimit = freeDirectLimitSetting
      ? Number(freeDirectLimitSetting.value)
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
    const freeDirectRemaining = Math.max(0, freeDirectLimit - (commits - releases));

    return {
      purchases,
      remainingByType,
      freeDirectLimit,
      freeDirectRemaining,
    };
  }
}
