import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AiTokenBucket,
  AiTokenLedgerAction,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';

export type AiTokenBalanceView = {
  planTokens: number;
  purchasedTokens: number;
  reservedTokens: number;
  totalAvailable: number;
};

@Injectable()
export class AiTokenService {
  constructor(private readonly prisma: PrismaService) {}

  private computeAvailable(balance: {
    planTokens: number;
    purchasedTokens: number;
    reservedTokens: number;
  }): number {
    const raw =
      balance.planTokens + balance.purchasedTokens - balance.reservedTokens;
    return Math.max(0, raw);
  }

  private toView(balance: {
    planTokens: number;
    purchasedTokens: number;
    reservedTokens: number;
  }): AiTokenBalanceView {
    return {
      planTokens: balance.planTokens,
      purchasedTokens: balance.purchasedTokens,
      reservedTokens: balance.reservedTokens,
      totalAvailable: this.computeAvailable(balance),
    };
  }

  private async ensureBalanceRow(
    tx: Prisma.TransactionClient,
    userId: string,
  ) {
    return tx.aiTokenBalance.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  async getBalance(userId: string): Promise<AiTokenBalanceView> {
    const balance = await this.prisma.aiTokenBalance.findUnique({
      where: { userId },
    });
    if (!balance) {
      return {
        planTokens: 0,
        purchasedTokens: 0,
        reservedTokens: 0,
        totalAvailable: 0,
      };
    }
    return this.toView(balance);
  }

  async hasKycWelcomeGrant(userId: string): Promise<boolean> {
    const row = await this.prisma.aiTokenLedger.findFirst({
      where: { userId, action: AiTokenLedgerAction.GRANT_KYC_WELCOME },
      select: { id: true },
    });
    return Boolean(row);
  }

  async grantKycWelcome(
    userId: string,
    amount: number,
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    if (amount <= 0) return false;

    if (tx) {
      const existing = await tx.aiTokenLedger.findFirst({
        where: { userId, action: AiTokenLedgerAction.GRANT_KYC_WELCOME },
        select: { id: true },
      });
      if (existing) return false;
      await this.grantKycWelcomeInTx(tx, userId, amount);
      return true;
    }

    return this.prisma.$transaction(async (innerTx) => {
      const existing = await innerTx.aiTokenLedger.findFirst({
        where: { userId, action: AiTokenLedgerAction.GRANT_KYC_WELCOME },
        select: { id: true },
      });
      if (existing) return false;
      await this.grantKycWelcomeInTx(innerTx, userId, amount);
      return true;
    });
  }

  private async grantKycWelcomeInTx(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
  ): Promise<void> {
    const balance = await this.ensureBalanceRow(tx, userId);
    const purchasedTokens = balance.purchasedTokens + amount;

    await tx.aiTokenBalance.update({
      where: { userId },
      data: { purchasedTokens },
    });

    await tx.aiTokenLedger.create({
      data: {
        userId,
        action: AiTokenLedgerAction.GRANT_KYC_WELCOME,
        bucket: AiTokenBucket.PURCHASED,
        amount,
        balanceAfter: this.computeAvailable({
          planTokens: balance.planTokens,
          purchasedTokens,
          reservedTokens: balance.reservedTokens,
        }),
        note: 'هدیه احراز هویت',
      },
    });
  }

  async resetPlanTokens(
    userId: string,
    amount: number,
    planPurchaseId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (amount < 0) {
      throw new BadRequestException('مقدار توکن پلن نامعتبر است');
    }

    const run = async (innerTx: Prisma.TransactionClient) => {
      const balance = await this.ensureBalanceRow(innerTx, userId);
      await innerTx.aiTokenBalance.update({
        where: { userId },
        data: { planTokens: amount },
      });

      await innerTx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.GRANT_PLAN,
          bucket: AiTokenBucket.PLAN,
          amount,
          balanceAfter: this.computeAvailable({
            planTokens: amount,
            purchasedTokens: balance.purchasedTokens,
            reservedTokens: balance.reservedTokens,
          }),
          planPurchaseId,
          note: 'شارژ توکن پلن',
        },
      });
    };

    if (tx) {
      await run(tx);
      return;
    }
    await this.prisma.$transaction(run);
  }

  async expirePlanTokens(userId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.aiTokenBalance.findUnique({ where: { userId } });
      if (!balance || balance.planTokens <= 0) return;

      const expiredAmount = balance.planTokens;
      await tx.aiTokenBalance.update({
        where: { userId },
        data: { planTokens: 0 },
      });

      await tx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.EXPIRE_PLAN,
          bucket: AiTokenBucket.PLAN,
          amount: -expiredAmount,
          balanceAfter: this.computeAvailable({
            planTokens: 0,
            purchasedTokens: balance.purchasedTokens,
            reservedTokens: balance.reservedTokens,
          }),
          note: 'انقضای توکن پلن',
        },
      });
    });
  }

  async grantPurchased(
    userId: string,
    amount: number,
    meta: { walletTxId: string; note?: string },
    tx?: Prisma.TransactionClient,
  ): Promise<AiTokenBalanceView> {
    if (amount <= 0) {
      throw new BadRequestException('مقدار توکن نامعتبر است');
    }

    const run = async (innerTx: Prisma.TransactionClient) => {
      const balance = await this.ensureBalanceRow(innerTx, userId);
      const purchasedTokens = balance.purchasedTokens + amount;

      await innerTx.aiTokenBalance.update({
        where: { userId },
        data: { purchasedTokens },
      });

      await innerTx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.PURCHASE,
          bucket: AiTokenBucket.PURCHASED,
          amount,
          balanceAfter: this.computeAvailable({
            planTokens: balance.planTokens,
            purchasedTokens,
            reservedTokens: balance.reservedTokens,
          }),
          walletTxId: meta.walletTxId,
          note: meta.note ?? 'خرید توکن',
        },
      });

      return this.toView({
        planTokens: balance.planTokens,
        purchasedTokens,
        reservedTokens: balance.reservedTokens,
      });
    };

    if (tx) return run(tx);
    return this.prisma.$transaction(run);
  }

  /**
   * شارژ / کسر دستی توکن توسط ادمین (روی سطل purchased).
   * amount مثبت = افزایش، منفی = کاهش.
   */
  async adminAdjust(
    userId: string,
    amount: number,
    meta?: { note?: string; adminId?: string },
  ): Promise<AiTokenBalanceView> {
    if (!Number.isInteger(amount) || amount === 0) {
      throw new BadRequestException('مقدار توکن نامعتبر است');
    }

    await this.assertUserExists(userId);

    return this.prisma.$transaction(async (tx) => {
      const balance = await this.ensureBalanceRow(tx, userId);
      const nextPurchased = balance.purchasedTokens + amount;
      if (nextPurchased < 0) {
        throw new BadRequestException('موجودی توکن خریداری‌شده کافی نیست');
      }

      await tx.aiTokenBalance.update({
        where: { userId },
        data: { purchasedTokens: nextPurchased },
      });

      const noteParts = [
        meta?.note?.trim() || 'تعدیل دستی توسط ادمین',
        meta?.adminId ? `admin:${meta.adminId}` : null,
      ].filter(Boolean);

      await tx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.ADMIN_ADJUST,
          bucket: AiTokenBucket.PURCHASED,
          amount,
          balanceAfter: this.computeAvailable({
            planTokens: balance.planTokens,
            purchasedTokens: nextPurchased,
            reservedTokens: balance.reservedTokens,
          }),
          note: noteParts.join(' · '),
        },
      });

      return this.toView({
        planTokens: balance.planTokens,
        purchasedTokens: nextPurchased,
        reservedTokens: balance.reservedTokens,
      });
    });
  }

  async reserve(
    userId: string,
    amount: number,
    requestId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (amount <= 0) {
      throw new BadRequestException('مقدار رزرو نامعتبر است');
    }

    const run = async (innerTx: Prisma.TransactionClient) => {
      const balance = await this.ensureBalanceRow(innerTx, userId);
      const available = this.computeAvailable(balance);
      if (available < amount) {
        throw new BadRequestException('توکن کافی برای این عملیات ندارید');
      }

      await innerTx.aiTokenBalance.update({
        where: { userId },
        data: { reservedTokens: { increment: amount } },
      });

      await innerTx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.RESERVE,
          amount: -amount,
          balanceAfter: available - amount,
          requestId,
          note: 'رزرو توکن',
        },
      });
    };

    if (tx) {
      await run(tx);
      return;
    }
    await this.prisma.$transaction(run);
  }

  async commit(
    userId: string,
    amount: number,
    requestId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (innerTx: Prisma.TransactionClient) => {
      const balance = await this.ensureBalanceRow(innerTx, userId);
      if (balance.reservedTokens < amount) {
        throw new BadRequestException('رزرو توکن یافت نشد');
      }

      let remaining = amount;
      let planDeduct = Math.min(balance.planTokens, remaining);
      remaining -= planDeduct;
      const purchasedDeduct = remaining;

      const planTokens = balance.planTokens - planDeduct;
      const purchasedTokens = balance.purchasedTokens - purchasedDeduct;
      const reservedTokens = balance.reservedTokens - amount;

      await innerTx.aiTokenBalance.update({
        where: { userId },
        data: { planTokens, purchasedTokens, reservedTokens },
      });

      await innerTx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.COMMIT,
          amount: -amount,
          balanceAfter: this.computeAvailable({
            planTokens,
            purchasedTokens,
            reservedTokens,
          }),
          requestId,
          note: 'مصرف توکن',
        },
      });
    };

    if (tx) {
      await run(tx);
      return;
    }
    await this.prisma.$transaction(run);
  }

  async release(
    userId: string,
    amount: number,
    requestId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (innerTx: Prisma.TransactionClient) => {
      const balance = await innerTx.aiTokenBalance.findUnique({
        where: { userId },
      });
      if (!balance) return;
      const releaseAmount = Math.min(amount, balance.reservedTokens);
      if (releaseAmount <= 0) return;

      const reservedTokens = balance.reservedTokens - releaseAmount;
      await innerTx.aiTokenBalance.update({
        where: { userId },
        data: { reservedTokens },
      });

      await innerTx.aiTokenLedger.create({
        data: {
          userId,
          action: AiTokenLedgerAction.RELEASE,
          amount: releaseAmount,
          balanceAfter: this.computeAvailable({
            planTokens: balance.planTokens,
            purchasedTokens: balance.purchasedTokens,
            reservedTokens,
          }),
          requestId,
          note: 'برگشت رزرو توکن',
        },
      });
    };

    if (tx) {
      await run(tx);
      return;
    }
    await this.prisma.$transaction(run);
  }

  async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');
  }
}
