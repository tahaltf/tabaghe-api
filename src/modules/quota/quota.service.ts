import { ForbiddenException, Injectable } from '@nestjs/common';
import { ListingType, Prisma, QuotaAction, QuotaReason } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class QuotaService {
  constructor(private readonly prisma: PrismaService) {}

  // -----------------------------
  // Public API
  // -----------------------------

  async consumeOnCreate(
    tx: Prisma.TransactionClient,
    userId: string,
    listingType: ListingType,
    listingId: string,
  ) {
    // فعلا فروش پلن/سهمیه غیرفعال است؛ محدودیت ثبت آگهی اعمال نشود.
    return;
  }

  async releaseOnReject(tx: Prisma.TransactionClient, listingId: string) {
    const ledger = await tx.quotaLedger.findFirst({
      where: {
        listingId,
        action: QuotaAction.COMMIT,
      },
    });

    if (!ledger) return;

    await tx.quotaLedger.create({
      data: {
        userId: ledger.userId,
        listingId,
        listingType: ledger.listingType,
        action: QuotaAction.RELEASE,
        reason: ledger.reason,
        planPurchaseId: ledger.planPurchaseId,
        note: 'آزادسازی سهمیه پس از رد آگهی توسط ادمین',
      },
    });
  }

  // -----------------------------
  // Free DIRECT quota
  // -----------------------------

  // اصلاح شده: حالا tx را ورودی می‌گیرد تا از کلاینت تراکنش استفاده کند
  private async getFreeDirectLimit(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const setting = await tx.systemSetting.findUnique({
      where: { key: 'FREE_DIRECT_QUOTA' },
    });
    return setting ? Number(setting.value) : 2;
  }

  private async getRemainingFreeDirect(
    tx: Prisma.TransactionClient,
    userId: string,
    freeLimit: number,
  ): Promise<number> {
    const commits = await tx.quotaLedger.count({
      where: {
        userId,
        listingType: ListingType.DIRECT,
        reason: QuotaReason.FREE_DIRECT,
        action: QuotaAction.COMMIT,
      },
    });

    const releases = await tx.quotaLedger.count({
      where: {
        userId,
        listingType: ListingType.DIRECT,
        reason: QuotaReason.FREE_DIRECT,
        action: QuotaAction.RELEASE,
      },
    });

    const used = commits - releases;
    return Math.max(0, freeLimit - used);
  }

  private async commitFreeDirect(
    tx: Prisma.TransactionClient,
    userId: string,
    listingType: ListingType,
    listingId: string,
  ) {
    await tx.quotaLedger.create({
      data: {
        userId,
        listingId,
        listingType,
        action: QuotaAction.COMMIT,
        reason: QuotaReason.FREE_DIRECT,
        note: 'سهمیه رایگان آگهی ثابت',
      },
    });
  }

  // -----------------------------
  // Plan quota
  // -----------------------------

  private async consumeFromPlan(
    tx: Prisma.TransactionClient,
    userId: string,
    listingType: ListingType,
    listingId: string,
  ) {
    const purchases = await tx.userPlanPurchase.findMany({
      where: {
        userId,
        status: 'ACTIVE',
      },
      include: {
        plan: {
          include: {
            rules: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const purchase of purchases) {
      const rule = purchase.plan.rules.find((r) => r.type === listingType);
      if (!rule) continue;

      const used = await tx.quotaLedger.count({
        where: {
          planPurchaseId: purchase.id,
          listingType,
          action: QuotaAction.COMMIT,
        },
      });

      if (used < rule.count) {
        await tx.quotaLedger.create({
          data: {
            userId,
            listingId,
            listingType,
            action: QuotaAction.COMMIT,
            reason: QuotaReason.PLAN,
            planPurchaseId: purchase.id,
            note: 'کسر از پلن فعال',
          },
        });
        return;
      }
    }

    throw new ForbiddenException(
      'سهمیه‌ای برای این نوع آگهی باقی نمانده است. پلن مناسب را تهیه کنید.',
    );
  }
}
