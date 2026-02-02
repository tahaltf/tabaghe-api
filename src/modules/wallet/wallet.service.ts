import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletTransactionType, WalletTransactionStatus } from '@prisma/client';

@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  // =================================================================
  // CORE & FETCH METHODS
  // =================================================================

  async getWalletByUserId(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }

    const transactions = await this.prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    return { ...wallet, transactions };
  }

  // =================================================================
  // DEPOSIT & WITHDRAW
  // =================================================================

  // ثبت واریز
  async deposit(userId: string, amount: number | any) {
    const wallet = await this.getWalletByUserId(userId);
    const numAmount = Number(amount);

    if (numAmount <= 0) throw new BadRequestException('مبلغ نامعتبر است');

    return this.prisma.$transaction([
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: numAmount,
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS جایگزین CONFIRMED شد
          meta: { description: 'شارژ آنلاین کیف پول' },
        },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceAvailable: { increment: numAmount } },
      }),
    ]);
  }

  // ثبت درخواست برداشت وجه
  async requestWithdraw(
    userId: string,
    dto: { amount: number | any; shaba: string; card: string; ownerName: string },
  ) {
    const wallet = await this.getWalletByUserId(userId);
    const numAmount = Number(dto.amount);

    if (Number(wallet.balanceAvailable) < numAmount) {
      throw new BadRequestException('موجودی قابل برداشت کافی نیست');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: { decrement: numAmount },
          balanceBlocked: { increment: numAmount },
        },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: numAmount,
          type: WalletTransactionType.WITHDRAW_REQUEST,
          status: WalletTransactionStatus.PENDING,
          meta: { ...dto, description: 'درخواست برداشت وجه' },
        },
      });
    });
  }

  // =================================================================
  // PAYMENT & SYSTEM METHODS (متد جدید اضافه شده برای رفع خطا)
  // =================================================================

  // متد جدید: پرداخت از موجودی در دسترس (برای خرید طرح یا پرداخت مستقیم)
  async payFromAvailable(userId: string, amount: number | any, referenceId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);

    // اطمینان از وجود کیف پول
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet || Number(wallet.balanceAvailable) < numAmount) {
      throw new BadRequestException('موجودی کیف پول کافی نیست');
    }

    // ۱. کسر از موجودی
    await prisma.wallet.update({
      where: { userId },
      data: { balanceAvailable: { decrement: numAmount } },
    });

    // ۲. ثبت تراکنش
    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: numAmount,
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: referenceId,
        meta: { description: 'پرداخت مستقیم از موجودی کیف پول' },
      },
    });
  }

  // =================================================================
  // AUCTION LOGIC
  // =================================================================

  async blockAmount(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet || Number(wallet.balanceAvailable) < numAmount) {
      throw new BadRequestException('موجودی کیف پول کافی نیست.');
    }

    await prisma.wallet.update({
      where: { userId },
      data: {
        balanceAvailable: { decrement: numAmount },
        balanceBlocked: { increment: numAmount },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: numAmount,
        type: WalletTransactionType.BLOCK,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: listingId,
        meta: { description: 'مسدودسازی بابت شرکت در مزایده' },
      },
    });
  }

  async unblockAmount(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    await prisma.wallet.update({
      where: { userId },
      data: {
        balanceAvailable: { increment: numAmount },
        balanceBlocked: { decrement: numAmount },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: numAmount,
        type: WalletTransactionType.UNBLOCK,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: listingId,
        meta: { description: 'آزادسازی مبلغ مسدود شده مزایده' },
      },
    });
  }

  async settleBlockedAmount(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    await prisma.wallet.update({
      where: { id: wallet.id },
      data: { balanceBlocked: { decrement: numAmount } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: numAmount,
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: listingId,
        meta: { description: 'تسویه نهایی معامله از وجه مسدود شده' },
      },
    });
  }

  async transfer({ toUserId, amount, listingId }: any, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);

    let sellerWallet = await prisma.wallet.findUnique({ where: { userId: toUserId } });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({
        data: { userId: toUserId, balanceAvailable: 0, balanceBlocked: 0 }
      });
    }

    await prisma.wallet.update({
      where: { userId: toUserId },
      data: { balanceAvailable: { increment: numAmount } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        amount: numAmount,
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: listingId,
        meta: { description: 'دریافت وجه بابت فروش کالا' },
      },
    });
  }

  async applyPenalty(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const numAmount = Number(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    await prisma.wallet.update({
      where: { userId },
      data: { balanceBlocked: { decrement: numAmount } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: numAmount,
        type: WalletTransactionType.PENALTY,
        status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
        referenceId: listingId,
        meta: { description: 'جریمه انصراف یا تخلف' },
      },
    });
  }

  // =================================================================
  // ADMIN METHODS
  // =================================================================

  async getWithdrawRequestsAdmin() {
    return this.prisma.walletTransaction.findMany({
      where: {
        type: WalletTransactionType.WITHDRAW_REQUEST,
        status: WalletTransactionStatus.PENDING,
      },
      include: {
        wallet: {
          include: {
            user: {
              // اصلاح شده: فیلد name حذف و فیلدهای صحیح جایگزین شد
              select: { firstName: true, lastName: true, phone: true }
            }
          }
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async processWithdraw(transactionId: string, action: 'APPROVE' | 'REJECT', adminNote?: string) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.findUnique({ where: { id: transactionId } });

      if (!transaction || transaction.status !== WalletTransactionStatus.PENDING) {
        throw new BadRequestException('تراکنش نامعتبر است یا قبلا پردازش شده');
      }

      if (action === 'APPROVE') {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balanceBlocked: { decrement: transaction.amount } },
        });

        await tx.walletTransaction.update({
          where: { id: transactionId },
          data: {
            status: WalletTransactionStatus.SUCCESS, // اصلاح شده: SUCCESS
            type: WalletTransactionType.WITHDRAW_PAID,
            meta: { ...(transaction.meta as object), adminNote, approvedAt: new Date() },
          },
        });

        return { message: 'درخواست برداشت تایید و مبلغ کسر شد' };

      } else {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: {
            balanceBlocked: { decrement: transaction.amount },
            balanceAvailable: { increment: transaction.amount },
          },
        });

        await tx.walletTransaction.update({
          where: { id: transactionId },
          data: {
            status: WalletTransactionStatus.FAILED,
            meta: { ...(transaction.meta as object), adminNote, rejectionReason: 'رد توسط ادمین' },
          },
        });

        return { message: 'درخواست رد شد و مبلغ به کیف پول بازگشت' };
      }
    });
  }
}