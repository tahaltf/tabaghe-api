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
import { WalletSupportService } from '../support/wallet-support.service';
import { WalletEscrowService } from '../escrow/wallet-escrow.service';

@Injectable()
export class WalletRefundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
    private readonly escrow: WalletEscrowService,
  ) {}

  private async resolveBuyerRefundAmount(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      totalAmount: number;
    },
  ): Promise<number> {
    const fromOrder = Math.max(0, Number(params.totalAmount) || 0);
    if (fromOrder > 0) return fromOrder;

    const wallet = await tx.wallet.findUnique({
      where: { userId: params.buyerId },
      select: { id: true },
    });
    if (!wallet) return 0;

    const settlements = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS,
        OR: [
          { referenceId: params.orderId },
          { referenceId: params.listingId },
        ],
      },
      select: { amount: true, meta: true, referenceId: true },
    });

    let sum = 0;
    for (const t of settlements) {
      const meta = (t.meta ?? {}) as Record<string, unknown>;
      const phase = String(meta['phase'] ?? '');
      if (phase !== 'buyer_paid' && phase !== 'exchange_participant_paid') {
        continue;
      }
      if (!this.support.settlementBelongsToExchangeOrder(t, params)) {
        continue;
      }
      sum += Math.max(0, Number(t.amount) || 0);
    }
    return sum;
  }

  /** مجموع پرداخت واقعی یک طرف در معاوضه (از روی SETTLEMENT کیف پول همان کاربر). */
  private async getExchangeParticipantPaidAmount(
    tx: Prisma.TransactionClient,
    params: {
      participantUserId: string;
      orderId: string;
      listingId: string;
    },
  ): Promise<number> {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.participantUserId },
      select: { id: true },
    });
    if (!wallet) return 0;

    const settlements = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS,
        OR: [
          { referenceId: params.orderId },
          { referenceId: params.listingId },
        ],
      },
      select: { amount: true, meta: true, referenceId: true },
    });

    let sum = 0;
    for (const t of settlements) {
      const meta = (t.meta ?? {}) as Record<string, unknown>;
      const phase = String(meta['phase'] ?? '');
      if (phase !== 'exchange_participant_paid') continue;
      if (!this.support.settlementBelongsToExchangeOrder(t, params)) continue;
      const payerUserId = String(
        meta['payerUserId'] ?? params.participantUserId,
      ).trim();
      if (payerUserId !== params.participantUserId) continue;
      sum += Math.max(0, Number(t.amount) || 0);
    }
    return sum;
  }

  /** لغو DEPOSIT امانی معلق و آزادسازی مبلغ بلوکه‌شده روی کیف طرف مقابل + ثبت تراکنش موفق برای گزارش کیف پول. */
  private async failExchangePendingDepositsUnwindBlocked(
    tx: Prisma.TransactionClient,
    params: {
      listingId: string;
      userIds: string[];
      orderId?: string;
      cancelReason?: string;
      debitReason?: string;
    },
  ): Promise<void> {
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
    const cancelReason =
      params.cancelReason ?? 'لغو معامله معاوضه';
    const debitReason =
      params.debitReason ?? 'exchange-escrow-unwind';

    for (const userId of params.userIds) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!wallet) continue;

      const pending = await tx.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
          referenceId: params.listingId,
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
        },
        select: { id: true, amount: true, meta: true },
      });

      const escrowPending = pending.filter((t) => {
        const meta = (t.meta ?? {}) as Record<string, unknown>;
        if (meta['kind'] !== 'order-escrow') return false;
        const metaListingId = String(meta['listingId'] ?? '').trim();
        if (metaListingId && metaListingId !== params.listingId) {
          return false;
        }
        const metaOrderId = String(meta['orderId'] ?? '').trim();
        if (params.orderId && metaOrderId && metaOrderId !== params.orderId) {
          return false;
        }
        return true;
      });
      if (!escrowPending.length) continue;

      let totalBlocked = 0;
      for (const dep of escrowPending) {
        const amount = Math.max(0, Number(dep.amount) || 0);
        if (amount <= 0) continue;
        totalBlocked += amount;

        const existingUnwind = await tx.walletTransaction.findFirst({
          where: {
            walletId: wallet.id,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            meta: { path: ['pendingDepositId'], equals: dep.id },
          },
          select: { id: true },
        });
        if (existingUnwind) continue;

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            amount,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: params.orderId ?? params.listingId,
            meta: {
              kind: 'order-escrow',
              phase: 'peer_blocked_unwind',
              pendingDepositId: dep.id,
              debitReason,
              orderId: params.orderId,
              listingId: params.listingId,
              ...(listingTitle ? { listingTitle } : {}),
              description: `لغو معامله برای ${titleQuoted}: مبلغ ${amount.toLocaleString('fa-IR')} تومان که به‌صورت امانی در کیف پول شما بلوکه شده بود، آزاد شد (${cancelReason}).`,
            } as Prisma.InputJsonValue,
          },
        });
      }

      if (totalBlocked > 0) {
        await tx.wallet.update({
          where: { userId },
          data: { balanceBlocked: { decrement: totalBlocked } },
        });
      }

      await tx.walletTransaction.updateMany({
        where: { id: { in: escrowPending.map((t) => t.id) } },
        data: { status: WalletTransactionStatus.FAILED },
      });
    }
  }

  /**
   * لغو فروش مستقیم (مثلاً عدم ارسال در مهلت): برگشت وجه خریدار + آزادسازی بلوکه فروشنده با ثبت تراکنش.
   */
  async refundDirectOrderEscrowOnCancel(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      totalAmount: number;
      sellerRevenue: number;
      cancelReason: string;
      refundReason?: string;
    },
  ): Promise<void> {
    const sellerRevenue = Math.max(0, Number(params.sellerRevenue) || 0);
    const refundReason = params.refundReason ?? 'shipping-timeout-cancel';
    const refundAmount = await this.resolveBuyerRefundAmount(tx, {
      orderId: params.orderId,
      listingId: params.listingId,
      buyerId: params.buyerId,
      totalAmount: params.totalAmount,
    });
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';

    if (sellerRevenue > 0) {
      const sellerWallet = await tx.wallet.upsert({
        where: { userId: params.sellerId },
        create: {
          userId: params.sellerId,
          balanceAvailable: 0,
          balanceBlocked: 0,
        },
        update: {},
        select: { id: true },
      });

      const existingSellerDebit = await tx.walletTransaction.findFirst({
        where: {
          walletId: sellerWallet.id,
          type: WalletTransactionType.PENALTY,
          referenceId: params.orderId,
          meta: { path: ['debitReason'], equals: refundReason },
        },
        select: { id: true },
      });
      if (!existingSellerDebit) {
        const clawed = await this.escrow.clawbackSellerPayout(tx, {
          userId: params.sellerId,
          orderId: params.orderId,
          listingId: params.listingId,
          requestedAmount: sellerRevenue,
          referenceId: params.orderId,
          penaltyMeta: {
            kind: 'order-escrow',
            phase: 'seller_blocked_debit',
            debitReason: refundReason,
            orderId: params.orderId,
            listingId: params.listingId,
            ...(listingTitle ? { listingTitle } : {}),
            description: `لغو معامله برای ${titleQuoted}: مبلغ از کیف پول شما برداشته شد چون سفارش لغو شد (${params.cancelReason}).`,
          },
        });
        const debited = clawed.fromBlocked + clawed.fromAvailable;
        if (debited > 0) {
          const pendingForOrder = await tx.walletTransaction.findMany({
            where: {
              walletId: sellerWallet.id,
              type: WalletTransactionType.DEPOSIT,
              status: WalletTransactionStatus.PENDING,
              OR: [
                { referenceId: params.orderId },
                { referenceId: params.listingId },
              ],
            },
            select: { id: true, meta: true },
          });
          const idsToFail = pendingForOrder
            .filter((row) => {
              const meta = (row.meta ?? {}) as Record<string, unknown>;
              if (meta['kind'] !== 'order-escrow') return false;
              return this.escrow.escrowDepositBelongsToOrder(meta, {
                orderId: params.orderId,
                listingId: params.listingId,
              });
            })
            .map((row) => row.id);
          if (idsToFail.length) {
            await tx.walletTransaction.updateMany({
              where: { id: { in: idsToFail } },
              data: { status: WalletTransactionStatus.FAILED },
            });
          }
        }
      }
    }

    if (refundAmount > 0) {
      const buyerWallet = await tx.wallet.upsert({
        where: { userId: params.buyerId },
        create: {
          userId: params.buyerId,
          balanceAvailable: 0,
          balanceBlocked: 0,
        },
        update: {},
        select: { id: true },
      });

      const existingBuyerRefund = await tx.walletTransaction.findFirst({
        where: {
          walletId: buyerWallet.id,
          type: WalletTransactionType.REFUND,
          referenceId: params.orderId,
        },
        select: { id: true },
      });
      if (!existingBuyerRefund) {
        await tx.wallet.update({
          where: { userId: params.buyerId },
          data: { balanceAvailable: { increment: refundAmount } },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            amount: refundAmount,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: params.orderId,
            meta: {
              kind: 'order-escrow',
              phase: 'buyer_refund',
              refundReason,
              orderId: params.orderId,
              listingId: params.listingId,
              ...(listingTitle ? { listingTitle } : {}),
              description: `بازگشت وجه خرید برای ${titleQuoted} به‌دلیل لغو سفارش (${params.cancelReason}). مبلغ به موجودی کیف پول شما واریز شد.`,
            },
          },
        });
        void this.support.notifyWalletRefund({
          userId: params.buyerId,
          amount: refundAmount,
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle,
          description: `بازگشت وجه خرید برای ${titleQuoted} به‌دلیل لغو سفارش.`,
        });
      }
    }
  }

  /**
   * اگر سفارش لغو شده ولی تراکنش بازگشت وجه خریدار ثبت نشده، دوباره تلاش می‌کند (repair).
   */
  async repairMissingDirectCancelRefund(orderId: string): Promise<{
    repaired: boolean;
    refundAmount: number;
    message: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        type: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        totalAmount: true,
        sellerRevenue: true,
        cancelReason: true,
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.status !== 'CANCELLED') {
      return {
        repaired: false,
        refundAmount: 0,
        message: 'سفارش در وضعیت لغو‌شده نیست.',
      };
    }
    if (order.type === 'EXCHANGE') {
      return {
        repaired: false,
        refundAmount: 0,
        message: 'این repair فقط برای فروش مستقیم است.',
      };
    }

    const cancelReason =
      order.cancelReason?.trim() ||
      'عدم ارسال فروشنده در مهلت مقرر؛ معامله لغو شد';

    let refundAmount = 0;
    await this.prisma.$transaction(async (tx) => {
      await this.refundDirectOrderEscrowOnCancel(tx, {
        orderId: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        totalAmount: Number(order.totalAmount || 0),
        sellerRevenue: Number(order.sellerRevenue || 0),
        cancelReason,
        refundReason: 'shipping-timeout-cancel',
      });
      refundAmount = await this.resolveBuyerRefundAmount(tx, {
        orderId: order.id,
        listingId: order.listingId,
        buyerId: order.buyerId,
        totalAmount: Number(order.totalAmount || 0),
      });
    });

    return {
      repaired: refundAmount > 0,
      refundAmount,
      message:
        refundAmount > 0
          ? `تراکنش بازگشت وجه (${refundAmount.toLocaleString('fa-IR')} تومان) برای خریدار ثبت یا تأیید شد.`
          : 'مبلغی برای بازگشت به خریدار یافت نشد.',
    };
  }

  /**
   * معاوضه: مابه‌التفاوت (غیر از هزینه کارشناسی) پس از پرداخت در کیف **طرف مقابل** بلوکه است.
   * برای لغو/مرجوع باید از بلوکهٔ مقابل کسر و به موجودی پرداخت‌کننده اضافه شود (نه releaseEscrow روی کیف خودش).
   */
  async refundExchangeExtraOnCancel(
    tx: Prisma.TransactionClient,
    params: {
      buyerId: string;
      sellerId: string;
      listingId: string;
      orderId: string;
      isPayerMe: boolean;
      buyerRefundable: number;
      sellerRefundable: number;
    },
  ): Promise<void> {
    const { buyerId, sellerId, listingId, orderId, isPayerMe } = params;
    const br = Math.max(0, Number(params.buyerRefundable) || 0);
    const sr = Math.max(0, Number(params.sellerRefundable) || 0);

    if (isPayerMe && br > 0) {
      const peerDebit = await this.escrow.debitOrderScopedBlocked(tx, {
        userId: sellerId,
        orderId,
        listingId,
        requestedAmount: br,
        referenceId: orderId,
        penaltyMeta: {
          kind: 'exchange-return-refund',
          orderId,
          listingId,
          description:
            'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت به پرداخت‌کننده',
        } as Prisma.InputJsonValue,
      });
      if (peerDebit > 0) {
        await tx.wallet.upsert({
          where: { userId: buyerId },
          create: { userId: buyerId, balanceAvailable: peerDebit, balanceBlocked: 0 },
          update: { balanceAvailable: { increment: peerDebit } },
        });
        const buyerWallet = await tx.wallet.findUnique({
          where: { userId: buyerId },
          select: { id: true },
        });
        if (buyerWallet) {
          await tx.walletTransaction.create({
            data: {
              walletId: buyerWallet.id,
              amount: peerDebit,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: orderId,
              meta: {
                kind: 'exchange-return-refund',
                orderId,
                listingId,
                description:
                  'بازگشت مابه‌التفاوت معاوضه به پرداخت‌کننده (بدون هزینه کارشناسی)',
              } as Prisma.InputJsonValue,
            },
          });
          void this.support.notifyWalletRefund({
            userId: buyerId,
            amount: peerDebit,
            orderId,
            listingId,
            description: 'بازگشت مابه‌التفاوت معاوضه به کیف پول شما.',
          });
        }
      }
    }

    if (!isPayerMe && sr > 0) {
      const peerDebit = await this.escrow.debitOrderScopedBlocked(tx, {
        userId: buyerId,
        orderId,
        listingId,
        requestedAmount: sr,
        referenceId: orderId,
        penaltyMeta: {
          kind: 'exchange-return-refund',
          orderId,
          listingId,
          description:
            'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت به پرداخت‌کننده',
        } as Prisma.InputJsonValue,
      });
      if (peerDebit > 0) {
        await tx.wallet.upsert({
          where: { userId: sellerId },
          create: { userId: sellerId, balanceAvailable: peerDebit, balanceBlocked: 0 },
          update: { balanceAvailable: { increment: peerDebit } },
        });
        const sellerWallet = await tx.wallet.findUnique({
          where: { userId: sellerId },
          select: { id: true },
        });
        if (sellerWallet) {
          await tx.walletTransaction.create({
            data: {
              walletId: sellerWallet.id,
              amount: peerDebit,
              type: WalletTransactionType.REFUND,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: orderId,
              meta: {
                kind: 'exchange-return-refund',
                orderId,
                listingId,
                description:
                  'بازگشت مابه‌التفاوت معاوضه به پرداخت‌کننده (بدون هزینه کارشناسی)',
              } as Prisma.InputJsonValue,
            },
          });
          void this.support.notifyWalletRefund({
            userId: sellerId,
            amount: peerDebit,
            orderId,
            listingId,
            description: 'بازگشت مابه‌التفاوت معاوضه به کیف پول شما.',
          });
        }
      }
    }
  }

  /** مبلغ واقعی پرداخت‌شده یک طرف در معاوضه (برای بازپرداخت/گزارش). */
  async resolveExchangeParticipantPaidAmount(
    tx: Prisma.TransactionClient,
    params: {
      participantUserId: string;
      orderId: string;
      listingId: string;
    },
  ): Promise<number> {
    return this.getExchangeParticipantPaidAmount(tx, params);
  }

  private async creditExchangeParticipantRefund(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      userId: string;
      participantRole: 'buyer' | 'seller';
      refundKind: string;
      refundReason: string;
      description: string;
      maxRefundAmount?: number;
    },
  ): Promise<number> {
    const paid = await this.getExchangeParticipantPaidAmount(tx, {
      participantUserId: params.userId,
      orderId: params.orderId,
      listingId: params.listingId,
    });
    const cap = Math.max(0, Number(params.maxRefundAmount) || 0);
    const refundAmount =
      cap > 0 ? Math.min(paid, cap) : paid;
    if (refundAmount <= 0) return 0;

    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );

    const wallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: { userId: params.userId, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
      select: { id: true },
    });

    const existing = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: WalletTransactionType.REFUND,
        referenceId: params.orderId,
        meta: { path: ['kind'], equals: params.refundKind },
      },
      select: { id: true },
    });
    if (existing) return 0;

    await tx.wallet.update({
      where: { userId: params.userId },
      data: { balanceAvailable: { increment: refundAmount } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: refundAmount,
        type: WalletTransactionType.REFUND,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: params.orderId,
        meta: {
          kind: params.refundKind,
          participantRole: params.participantRole,
          refundReason: params.refundReason,
          orderId: params.orderId,
          listingId: params.listingId,
          ...(listingTitle ? { listingTitle } : {}),
          description: params.description,
        } as Prisma.InputJsonValue,
      },
    });
    void this.support.notifyWalletRefund({
      userId: params.userId,
      amount: refundAmount,
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle,
      description: params.description,
    });
    return refundAmount;
  }

  /**
   * معاوضه: مهلت پرداخت تمام شد — بازپرداخت سهم هر طرفی که واقعاً پرداخت کرده.
   */
  async refundExchangePaymentTimeoutOnCancel(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      refundBuyer: boolean;
      refundSeller: boolean;
      buyerMaxRefund?: number;
      sellerMaxRefund?: number;
    },
  ): Promise<{ buyerRefund: number; sellerRefund: number }> {
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
    const refundReason = 'exchange-payment-timeout-cancel';
    const refundKind = 'exchange-payment-timeout-participant-refund';

    let buyerRefund = 0;
    let sellerRefund = 0;

    if (params.refundBuyer) {
      buyerRefund = await this.creditExchangeParticipantRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: params.buyerId,
        participantRole: 'buyer',
        refundKind,
        refundReason,
        description: `بازگشت سهم پرداختی معاوضه برای ${titleQuoted} به‌دلیل لغو معامله (اتمام مهلت پرداخت).`,
        maxRefundAmount: params.buyerMaxRefund,
      });
    }
    if (params.refundSeller) {
      sellerRefund = await this.creditExchangeParticipantRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: params.sellerId,
        participantRole: 'seller',
        refundKind,
        refundReason,
        description: `بازگشت سهم پرداختی معاوضه برای ${titleQuoted} به‌دلیل لغو معامله (اتمام مهلت پرداخت).`,
        maxRefundAmount: params.sellerMaxRefund,
      });
    }

    await this.failExchangePendingDepositsUnwindBlocked(tx, {
      listingId: params.listingId,
      userIds: [params.buyerId, params.sellerId],
      orderId: params.orderId,
      cancelReason: 'اتمام مهلت پرداخت معاوضه',
      debitReason: refundReason,
    });

    return { buyerRefund, sellerRefund };
  }

  /**
   * معاوضه: یک طرف ارسال کرده، طرف مقابل در مهلت ارسال نکرده.
   * فرستنده: بازگشت کامل سهم پرداختی + جبران از سهم کارشناسی طرف مقصر.
   * طرف مقصر: بازگشت مابه‌التفاوت (در صورت وجود) + بخشی از کارشناسی پس از کسر درصد جریمه.
   */
  async refundExchangeOneSideNoShipmentOnCancel(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      senderId: string;
      offenderId: string;
      verificationFee: number;
      inspectionPenaltyPercent: number;
    },
  ): Promise<{
    senderRefund: number;
    offenderRefund: number;
    compensation: number;
  }> {
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
    const verificationFee = Math.max(0, Number(params.verificationFee) || 0);
    const penaltyPercent = Math.min(
      100,
      Math.max(0, Number(params.inspectionPenaltyPercent) || 0),
    );
    const penaltyAmount = Math.max(
      0,
      Math.floor((verificationFee * penaltyPercent) / 100),
    );

    const senderRefund = await this.creditExchangeParticipantRefund(tx, {
      orderId: params.orderId,
      listingId: params.listingId,
      userId: params.senderId,
      participantRole: params.senderId === params.buyerId ? 'buyer' : 'seller',
      refundKind: 'exchange-one-side-shipment-sender-refund',
      refundReason: 'exchange-one-side-no-shipment-cancel',
      description: `بازگشت کامل سهم پرداختی شما برای ${titleQuoted} به‌دلیل لغو معاوضه (عدم ارسال طرف مقابل).`,
    });

    const offenderPaid = await this.getExchangeParticipantPaidAmount(tx, {
      participantUserId: params.offenderId,
      orderId: params.orderId,
      listingId: params.listingId,
    });
    const offenderRefundAmount = Math.max(0, offenderPaid - penaltyAmount);
    let offenderRefund = 0;
    if (offenderRefundAmount > 0) {
      offenderRefund = await this.creditExchangeFixedRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: params.offenderId,
        amount: offenderRefundAmount,
        participantRole:
          params.offenderId === params.buyerId ? 'buyer' : 'seller',
        refundKind: 'exchange-one-side-shipment-offender-refund',
        refundReason: 'exchange-one-side-no-shipment-cancel',
        description: `بازگشت سهم پرداختی شما برای ${titleQuoted} پس از کسر ${penaltyPercent}٪ جریمه کارشناسی (عدم ارسال در مهلت).`,
        listingTitle,
      });
    }

    let compensation = 0;
    if (penaltyAmount > 0) {
      compensation = await this.creditExchangeFixedRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: params.senderId,
        amount: penaltyAmount,
        participantRole:
          params.senderId === params.buyerId ? 'buyer' : 'seller',
        refundKind: 'exchange-one-side-shipment-compensation',
        refundReason: 'exchange-one-side-no-shipment-compensation',
        description: `جبران ${penaltyPercent}٪ از هزینه کارشناسی طرف مقابل به شما بابت ارسال به‌موقع و عدم ارسال طرف دیگر.`,
        listingTitle,
      });
    }

    await this.failExchangePendingDepositsUnwindBlocked(tx, {
      listingId: params.listingId,
      userIds: [params.buyerId, params.sellerId],
      orderId: params.orderId,
      cancelReason: 'لغو معامله معاوضه (عدم ارسال یک طرف)',
      debitReason: 'exchange-one-side-shipment-cancel',
    });

    return { senderRefund, offenderRefund, compensation };
  }

  private async creditExchangeFixedRefund(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      userId: string;
      amount: number;
      participantRole: 'buyer' | 'seller';
      refundKind: string;
      refundReason: string;
      description: string;
      listingTitle?: string;
    },
  ): Promise<number> {
    const amount = Math.max(0, Number(params.amount) || 0);
    if (amount <= 0) return 0;

    const wallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: { userId: params.userId, balanceAvailable: 0, balanceBlocked: 0 },
      update: {},
      select: { id: true },
    });

    const existing = await tx.walletTransaction.findFirst({
      where: {
        walletId: wallet.id,
        type: WalletTransactionType.REFUND,
        referenceId: params.orderId,
        meta: { path: ['kind'], equals: params.refundKind },
      },
      select: { id: true },
    });
    if (existing) return 0;

    await tx.wallet.update({
      where: { userId: params.userId },
      data: { balanceAvailable: { increment: amount } },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: WalletTransactionType.REFUND,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: params.orderId,
        meta: {
          kind: params.refundKind,
          participantRole: params.participantRole,
          refundReason: params.refundReason,
          orderId: params.orderId,
          listingId: params.listingId,
          ...(params.listingTitle ? { listingTitle: params.listingTitle } : {}),
          description: params.description,
        } as Prisma.InputJsonValue,
      },
    });
    void this.support.notifyWalletRefund({
      userId: params.userId,
      amount,
      orderId: params.orderId,
      listingId: params.listingId,
      listingTitle: params.listingTitle,
      description: params.description,
    });
    return amount;
  }

  /**
   * معاوضه: هر دو طرف در مهلت ارسال، کالا را نفرستاده‌اند.
   * بازگشت کامل سهم پرداختی هر طرف (بدون جریمهٔ درصدی کارشناسی؛ آن درصد فقط برای «یک طرف ارسال نکرده» است).
   */
  async refundExchangeBothNoShipmentOnCancel(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      verificationFee: number;
      inspectionPenaltyPercent: number;
    },
  ): Promise<{
    buyerPaid: number;
    sellerPaid: number;
    buyerRefund: number;
    sellerRefund: number;
    penaltyPerParty: number;
    penaltyPercent: number;
  }> {
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
    const refundReason = 'exchange-both-no-shipment-cancel';
    const verificationFee = Math.max(0, Number(params.verificationFee) || 0);
    const penaltyPercent = Math.min(
      100,
      Math.max(0, Number(params.inspectionPenaltyPercent) || 0),
    );
    const penaltyPerParty = Math.max(
      0,
      Math.floor((verificationFee * penaltyPercent) / 100),
    );

    const summary = {
      buyerPaid: 0,
      sellerPaid: 0,
      buyerRefund: 0,
      sellerRefund: 0,
      penaltyPerParty,
      penaltyPercent,
    };

    for (const party of [
      { userId: params.buyerId, role: 'buyer' as const },
      { userId: params.sellerId, role: 'seller' as const },
    ]) {
      const paid = await this.getExchangeParticipantPaidAmount(tx, {
        participantUserId: party.userId,
        orderId: params.orderId,
        listingId: params.listingId,
      });
      const refundAmount = Math.max(0, paid - penaltyPerParty);
      if (party.role === 'buyer') {
        summary.buyerPaid = paid;
        summary.buyerRefund = refundAmount;
      } else {
        summary.sellerPaid = paid;
        summary.sellerRefund = refundAmount;
      }
      if (refundAmount <= 0) continue;
      await this.creditExchangeFixedRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: party.userId,
        amount: refundAmount,
        participantRole: party.role,
        refundKind: 'exchange-both-no-shipment-participant-refund',
        refundReason,
        description:
          penaltyPerParty > 0
            ? `بازگشت سهم پرداختی معاوضه برای ${titleQuoted} پس از کسر ${penaltyPercent}٪ جریمه کارشناسی (عدم ارسال هر دو طرف).`
            : `بازگشت سهم پرداختی معاوضه برای ${titleQuoted} به‌دلیل لغو معامله (عدم ارسال هر دو طرف).`,
        listingTitle: listingTitle ?? undefined,
      });
    }

    await this.failExchangePendingDepositsUnwindBlocked(tx, {
      listingId: params.listingId,
      userIds: [params.buyerId, params.sellerId],
      orderId: params.orderId,
      cancelReason: 'لغو معامله معاوضه (عدم ارسال هر دو طرف)',
      debitReason: refundReason,
    });

    return summary;
  }

  /**
   * معاوضه: پس از کارشناسی با «مرجوع هر دو کالا» — تسویه مالی طرفین.
   * - هر دو رد: هزینه کارشناسی هیچ‌کدام عودت نمی‌شود (فقط سهم غیرکارشناسی برمی‌گردد).
   * - یکی رد / یکی تایید: تاییدشده عودت کامل می‌گیرد؛ ردشده هزینه کارشناسی‌اش را از دست می‌دهد
   *   و درصد دلجویی از همان سهم کارشناسی ردشده به تاییدشده واریز می‌شود.
   */
  async applyExchangeHubInspectionOutcomeRefunds(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      buyerId: string;
      sellerId: string;
      verificationFee: number;
      inspectionPenaltyPercent: number;
      listingFailed: boolean;
      offerFailed: boolean;
    },
  ): Promise<{ buyerRefundAmount: number; sellerRefundAmount: number }> {
    const summary = { buyerRefundAmount: 0, sellerRefundAmount: 0 };
    const listingTitle = await this.support.listingTitleForWalletTx(
      tx,
      params.listingId,
    );
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
    const verificationFee = Math.max(0, Number(params.verificationFee) || 0);
    const penaltyPercent = Math.min(
      100,
      Math.max(0, Number(params.inspectionPenaltyPercent) || 0),
    );
    const compensationAmount = Math.max(
      0,
      Math.floor((verificationFee * penaltyPercent) / 100),
    );
    const bothFailed = params.listingFailed && params.offerFailed;
    const mixedOutcome =
      (params.listingFailed || params.offerFailed) && !bothFailed;

    const refundReason = 'exchange-hub-inspection-return';

    if (bothFailed) {
      for (const party of [
        { userId: params.buyerId, role: 'buyer' as const },
        { userId: params.sellerId, role: 'seller' as const },
      ]) {
        const paid = await this.getExchangeParticipantPaidAmount(tx, {
          participantUserId: party.userId,
          orderId: params.orderId,
          listingId: params.listingId,
        });
        const refundAmount = Math.max(0, paid - verificationFee);
        if (party.role === 'buyer') {
          summary.buyerRefundAmount = refundAmount;
        } else {
          summary.sellerRefundAmount = refundAmount;
        }
        if (refundAmount <= 0) continue;
        await this.creditExchangeFixedRefund(tx, {
          orderId: params.orderId,
          listingId: params.listingId,
          userId: party.userId,
          amount: refundAmount,
          participantRole: party.role,
          refundKind: 'exchange-inspection-both-fail-refund',
          refundReason,
          description:
            verificationFee > 0
              ? `بازگشت سهم پرداختی غیرکارشناسی پس از رد کارشناسی هر دو کالا (هزینه کارشناسی مسترد نشد) — ${titleQuoted}.`
              : `بازگشت سهم پرداختی پس از رد کارشناسی هر دو کالا — ${titleQuoted}.`,
          listingTitle: listingTitle ?? undefined,
        });
      }
    } else if (mixedOutcome) {
      const offenderId = params.listingFailed
        ? params.sellerId
        : params.buyerId;
      const healthyId = params.listingFailed
        ? params.buyerId
        : params.sellerId;
      const healthyRole =
        healthyId === params.buyerId ? ('buyer' as const) : ('seller' as const);
      const offenderRole =
        offenderId === params.buyerId ? ('buyer' as const) : ('seller' as const);

      const healthyRefundAmount = await this.creditExchangeParticipantRefund(tx, {
        orderId: params.orderId,
        listingId: params.listingId,
        userId: healthyId,
        participantRole: healthyRole,
        refundKind: 'exchange-inspection-mixed-healthy-full-refund',
        refundReason,
        description: `بازگشت کامل سهم پرداختی شما پس از تایید کارشناسی کالایتان — ${titleQuoted}.`,
      });
      if (healthyRole === 'buyer') {
        summary.buyerRefundAmount += healthyRefundAmount;
      } else {
        summary.sellerRefundAmount += healthyRefundAmount;
      }

      const offenderPaid = await this.getExchangeParticipantPaidAmount(tx, {
        participantUserId: offenderId,
        orderId: params.orderId,
        listingId: params.listingId,
      });
      const offenderRefundAmount = Math.max(0, offenderPaid - verificationFee);
      if (offenderRefundAmount > 0) {
        const creditedOffender = await this.creditExchangeFixedRefund(tx, {
          orderId: params.orderId,
          listingId: params.listingId,
          userId: offenderId,
          amount: offenderRefundAmount,
          participantRole: offenderRole,
          refundKind: 'exchange-inspection-mixed-offender-refund',
          refundReason,
          description:
            verificationFee > 0
              ? `بازگشت سهم پرداختی غیرکارشناسی شما؛ هزینه کارشناسی به‌دلیل رد کالا مسترد نشد — ${titleQuoted}.`
              : `بازگشت باقی‌مانده سهم پرداختی شما پس از رد کالا — ${titleQuoted}.`,
          listingTitle: listingTitle ?? undefined,
        });
        if (offenderRole === 'buyer') {
          summary.buyerRefundAmount += creditedOffender;
        } else {
          summary.sellerRefundAmount += creditedOffender;
        }
      }

      if (compensationAmount > 0) {
        const compensation = await this.creditExchangeFixedRefund(tx, {
          orderId: params.orderId,
          listingId: params.listingId,
          userId: healthyId,
          amount: compensationAmount,
          participantRole: healthyRole,
          refundKind: 'exchange-inspection-mixed-compensation',
          refundReason: 'exchange-inspection-mixed-compensation',
          description: `جبران ${penaltyPercent}٪ از هزینه کارشناسی طرف مقابل (کالای رد‌شده) — ${titleQuoted}.`,
          listingTitle: listingTitle ?? undefined,
        });
        if (healthyRole === 'buyer') {
          summary.buyerRefundAmount += compensation;
        } else {
          summary.sellerRefundAmount += compensation;
        }
      }
    }

    await this.failExchangePendingDepositsUnwindBlocked(tx, {
      listingId: params.listingId,
      userIds: [params.buyerId, params.sellerId],
      orderId: params.orderId,
      cancelReason: 'لغو معامله پس از کارشناسی',
      debitReason: 'exchange-inspection-outcome',
    });
    return summary;
  }
}
