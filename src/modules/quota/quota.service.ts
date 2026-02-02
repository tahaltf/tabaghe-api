import { ForbiddenException, Injectable } from '@nestjs/common';
import { ListingType, Prisma, QuotaAction, QuotaReason } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

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
      return
    if (listingType === ListingType.DIRECT) {
      // پاس دادن tx به متد دریافت لیمیت برای جلوگیری از ارور undefined
      const freeLimit = await this.getFreeDirectLimit(tx);
      const freeLeft = await this.getRemainingFreeDirect(tx, userId, freeLimit);

      if (freeLeft > 0) {
        await this.commitFreeDirect(tx, userId, listingType, listingId);
        return;
      }
    }

    await this.consumeFromPlan(tx, userId, listingType, listingId);
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
        note: 'Released due to admin rejection',
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
    try {
      // استفاده از tx به جای this.prisma
      const setting = await (tx as any).appSetting.findUnique({
        where: { key: 'FREE_DIRECT_QUOTA' },
      });

      return setting ? Number(setting.value) : 2;
    } catch (error) {
      // اگر جدول appSetting وجود نداشت یا مشکلی بود، پیش‌فرض ۲ را برگردان
      return 2;
    }
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
        note: 'Free direct listing quota',
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
            note: 'Consumed from plan',
          },
        });
        return;
      }
    }

    throw new ForbiddenException('No quota available for this listing type');
  }
}
