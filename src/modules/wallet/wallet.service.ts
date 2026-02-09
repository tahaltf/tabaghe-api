import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletTransactionType, WalletTransactionStatus } from '@prisma/client';
import Decimal from 'decimal.js'; // ✅ استفاده از کتابخانه دقیق ریاضی

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
  // AUCTION LOGIC (اصلاح شده با Decimal Strict Check)
  // =================================================================

  async blockAmount(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;

    // ۱. تبدیل ورودی به فرمت دقیق Decimal
    const amountDec = new Decimal(amount);

    if (amountDec.lte(0)) {
      throw new BadRequestException('مبلغ مسدودسازی نامعتبر است (صفر یا منفی)');
    }

    // ۲. دریافت کیف پول
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    // اگر کیف پول وجود ندارد، یعنی موجودی ۰ است
    if (!wallet) {
      console.error(`[Block Check] Wallet not found for user ${userId}`);
      throw new BadRequestException(`موجودی کافی نیست (کیف پول یافت نشد، موجودی: ۰)`);
    }

    const balanceDec = new Decimal(wallet.balanceAvailable);

    // ۳. لاگ دقیق برای اینکه در کنسول سرور ببینید چه خبر است
    console.log(`[Wallet Block Check] User: ${userId}`);
    console.log(`Current Balance: ${balanceDec.toString()}`);
    console.log(`Required Deposit: ${amountDec.toString()}`);

    // ۴. مقایسه دقیق ریاضی (اگر موجودی کمتر از مبلغ درخواستی باشد)
    // استفاده از .lt() به جای عملگر < بسیار حیاتی است
    if (balanceDec.lt(amountDec)) {
      console.error('[Block Check] Failed: Balance check failed');
      // ✅ اصلاح شده: نمایش ۳ رقم ۳ رقم مبالغ
      const current = balanceDec.toNumber().toLocaleString();
      const required = amountDec.toNumber().toLocaleString();
      throw new BadRequestException(`موجودی کیف پول کافی نیست. (موجودی: ${current} تومان، ودیعه مورد نیاز: ${required} تومان)`);
    }

    // ۵. کسر و بلوکه کردن
    await prisma.wallet.update({
      where: { userId },
      data: {
        balanceAvailable: { decrement: amountDec.toString() }, // استفاده از رشته برای دقت Prisma
        balanceBlocked: { increment: amountDec.toString() },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(), // برای ذخیره در دیتابیس
        type: WalletTransactionType.BLOCK,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: listingId,
        meta: { description: 'مسدودسازی ودیعه شرکت در مزایده' },
      },
    });
  }

  async unblockAmount(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);

    // دریافت والت برای اطمینان از وجود آن
    const wallet = await this.getWalletByUserId(userId);

    await prisma.wallet.update({
      where: { userId },
      data: {
        balanceAvailable: { increment: amountDec.toString() },
        balanceBlocked: { decrement: amountDec.toString() },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.UNBLOCK,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: listingId,
        meta: { description: 'آزادسازی مبلغ مسدود شده مزایده' },
      },
    });
  }

  async confiscateBlocked(userId: string, amount: number | any, listingId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const wallet = await this.getWalletByUserId(userId);

    await prisma.wallet.update({
      where: { userId },
      data: { balanceBlocked: { decrement: amountDec.toString() } }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.PENALTY,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: listingId,
        meta: { description: 'جریمه عدم پرداخت مزایده (ضبط ودیعه)' }
      }
    });
  }

  async payAuctionFinal(
    buyerId: string,
    sellerId: string,
    totalAmount: number | any,
    blockedDeposit: number | any,
    refId: string,
    tx?: any
  ) {
    const prisma = tx || this.prisma;
    const totalDec = new Decimal(totalAmount);
    const depositDec = new Decimal(blockedDeposit);
    const remainderDec = totalDec.minus(depositDec);

    // ۱. چک موجودی برای مابقی
    const buyerWallet = await prisma.wallet.findUnique({ where: { userId: buyerId } });
    if (!buyerWallet) throw new BadRequestException('کیف پول خریدار یافت نشد');

    const buyerBalance = new Decimal(buyerWallet.balanceAvailable);

    if (remainderDec.gt(0) && buyerBalance.lt(remainderDec)) {
      throw new BadRequestException('موجودی آزاد برای پرداخت مابه‌تفاوت کافی نیست');
    }

    // ۲. کسر ودیعه از Blocked
    if (depositDec.gt(0)) {
      await prisma.wallet.update({
        where: { userId: buyerId },
        data: { balanceBlocked: { decrement: depositDec.toString() } }
      });
    }

    // ۳. کسر مابقی از Available
    if (remainderDec.gt(0)) {
      await prisma.wallet.update({
        where: { userId: buyerId },
        data: { balanceAvailable: { decrement: remainderDec.toString() } }
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          amount: remainderDec.toNumber(),
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: refId,
          meta: { description: 'پرداخت مابه‌تفاوت مزایده' }
        }
      });
    }

    // ۴. واریز به فروشنده
    let sellerWallet = await prisma.wallet.findUnique({ where: { userId: sellerId } });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({ data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 } });
    }

    await prisma.wallet.update({
      where: { userId: sellerId },
      data: { balanceAvailable: { increment: totalDec.toString() } }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        amount: totalDec.toNumber(),
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: refId,
        meta: { description: 'دریافت وجه فروش مزایده' }
      }
    });
  }

  // =================================================================
  // ESCROW & OTHER METHODS
  // =================================================================

  async transferToEscrow(buyerId: string, sellerId: string, amount: number | any, refId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);

    const buyerWallet = await prisma.wallet.findUnique({ where: { userId: buyerId } });

    if (!buyerWallet || new Decimal(buyerWallet.balanceAvailable).lt(amountDec)) {
      throw new BadRequestException('موجودی کیف پول برای خرید کافی نیست');
    }

    await prisma.wallet.update({
      where: { userId: buyerId },
      data: { balanceAvailable: { decrement: amountDec.toString() } }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: buyerWallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: refId,
        meta: { description: 'پرداخت سفارش (بلوکه نزد فروشنده)' }
      }
    });

    let sellerWallet = await prisma.wallet.findUnique({ where: { userId: sellerId } });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({
        data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 }
      });
    }

    await prisma.wallet.update({
      where: { userId: sellerId },
      data: { balanceBlocked: { increment: amountDec.toString() } }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        referenceId: refId,
        meta: { description: 'دریافت وجه سفارش (بلوکه)' }
      }
    });
  }

  async releaseEscrow(sellerId: string, amount: number | any, refId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const wallet = await this.getWalletByUserId(sellerId);

    await prisma.wallet.update({
      where: { userId: sellerId },
      data: {
        balanceBlocked: { decrement: amountDec.toString() },
        balanceAvailable: { increment: amountDec.toString() }
      }
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.UNBLOCK,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: refId,
        meta: { description: 'آزادسازی وجه سفارش' }
      }
    });
  }

  // =================================================================
  // STANDARD METHODS (Deposit / Withdraw)
  // =================================================================

  async deposit(userId: string, amount: number | any) {
    const wallet = await this.getWalletByUserId(userId);
    const amountDec = new Decimal(amount);
    if (amountDec.lte(0)) throw new BadRequestException('مبلغ نامعتبر است');

    return this.prisma.$transaction([
      this.prisma.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: amountDec.toNumber(),
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.SUCCESS,
          meta: { description: 'شارژ آنلاین کیف پول' },
        },
      }),
      this.prisma.wallet.update({
        where: { id: wallet.id },
        data: { balanceAvailable: { increment: amountDec.toString() } },
      }),
    ]);
  }

  async requestWithdraw(userId: string, dto: any) {
    const amountDec = new Decimal(dto.amount);
    const wallet = await this.getWalletByUserId(userId);

    // چک دقیق موجودی برای برداشت
    if (new Decimal(wallet.balanceAvailable).lt(amountDec)) {
      throw new BadRequestException('موجودی قابل برداشت کافی نیست');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.wallet.update({
        where: { userId },
        data: {
          balanceAvailable: { decrement: amountDec.toString() },
          balanceBlocked: { increment: amountDec.toString() },
        },
      });

      return tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: amountDec.toNumber(),
          type: WalletTransactionType.WITHDRAW_REQUEST,
          status: WalletTransactionStatus.PENDING,
          meta: { ...dto, description: 'درخواست برداشت وجه' },
        },
      });
    });
  }

  async payFromAvailable(userId: string, amount: number | any, referenceId: string, tx?: any) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const wallet = await prisma.wallet.findUnique({ where: { userId } });

    if (!wallet || new Decimal(wallet.balanceAvailable).lt(amountDec)) {
      throw new BadRequestException('موجودی کیف پول کافی نیست');
    }

    await prisma.wallet.update({
      where: { userId },
      data: { balanceAvailable: { decrement: amountDec.toString() } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: referenceId,
        meta: { description: 'پرداخت از موجودی' },
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
            status: WalletTransactionStatus.SUCCESS,
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