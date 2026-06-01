import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  Prisma,
  NotificationType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { WalletQueryService } from '../query/wallet-query.service';

@Injectable()
export class WalletBlockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly query: WalletQueryService,
  ) {}

  async blockAmount(
    userId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);

    if (amountDec.lte(0))
      throw new BadRequestException('مبلغ مسدودسازی نامعتبر است');

    const wallet = await prisma.wallet.findUnique({ where: { userId } });
    if (!wallet)
      throw new BadRequestException('موجودی کافی نیست (کیف پول یافت نشد)');

    const balanceDec = new Decimal(wallet.balanceAvailable);

    if (balanceDec.lt(amountDec)) {
      const current = balanceDec.toNumber().toLocaleString();
      const required = amountDec.toNumber().toLocaleString();
      throw new BadRequestException(
        `موجودی کیف پول کافی نیست. (موجودی: ${current} تومان، ودیعه مورد نیاز: ${required} تومان)`,
      );
    }

    await prisma.wallet.update({
      where: { userId },
      data: {
        balanceAvailable: { decrement: amountDec.toString() },
        balanceBlocked: { increment: amountDec.toString() },
      },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.BLOCK,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: listingId,
        meta: {
          kind: 'auction-bid-deposit',
          listingId,
          description: 'مسدودسازی ودیعه شرکت در مزایده',
        },
      },
    });
  }

  /**
   * ودیعهٔ بلوکه‌شدهٔ شرکت در یک مزایده (بر اساس لاگ BLOCK/UNBLOCK همان listingId).
   */
  async getAuctionBidDepositScopedBlocked(
    tx: Prisma.TransactionClient,
    params: { userId: string; listingId: string },
  ): Promise<number> {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
      select: { id: true },
    });
    if (!wallet) return 0;

    const rows = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        referenceId: params.listingId,
        status: WalletTransactionStatus.SUCCESS,
        type: {
          in: [
            WalletTransactionType.BLOCK,
            WalletTransactionType.UNBLOCK,
            WalletTransactionType.PENALTY,
          ],
        },
      },
      select: { amount: true, type: true, meta: true },
    });

    let net = 0;
    for (const row of rows) {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const kind = String(meta['kind'] ?? '').trim();
      if (kind && kind !== 'auction-bid-deposit') continue;
      const metaListingId = String(meta['listingId'] ?? params.listingId).trim();
      if (metaListingId !== params.listingId) continue;
      const amt = Math.max(0, Number(row.amount) || 0);
      if (row.type === WalletTransactionType.BLOCK) net += amt;
      else net -= amt;
    }
    return Math.max(0, net);
  }

  async unblockAmount(
    userId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const requested = new Decimal(amount);
    const scoped = await this.getAuctionBidDepositScopedBlocked(prisma, {
      userId,
      listingId,
    });
    const amountDec = Decimal.min(requested, new Decimal(scoped));
    if (amountDec.lte(0)) return;

    const wallet = await this.query.getWalletByUserId(userId);

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
        meta: {
          kind: 'auction-bid-deposit',
          listingId,
          description: 'آزادسازی مبلغ مسدود شده مزایده',
        },
      },
    });
  }

  async confiscateBlocked(
    userId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const requested = new Decimal(amount);
    const scoped = await this.getAuctionBidDepositScopedBlocked(prisma, {
      userId,
      listingId,
    });
    const amountDec = Decimal.min(requested, new Decimal(scoped));
    if (amountDec.lte(0)) return;

    const wallet = await this.query.getWalletByUserId(userId);

    await prisma.wallet.update({
      where: { userId },
      data: { balanceBlocked: { decrement: amountDec.toString() } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.PENALTY,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: listingId,
        meta: {
          kind: 'auction-bid-deposit',
          listingId,
          description: 'جریمه عدم پرداخت مزایده (ضبط ودیعه)',
        },
      },
    });
  }

  // ✅ اصلاح شد: واریز به حساب بلوکه شده فروشنده (Escrow) + کسر کارمزد
}
