import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  Prisma,
  NotificationType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { NotificationService } from '../notification/notification.service';
import {
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '../../shared/contracts/pagination';

/**
 * Marker stored inside `WalletTransaction.meta.kind` to distinguish user-initiated
 * top-up requests (DEPOSIT + PENDING, awaiting admin approval) from escrow
 * deposits credited to sellers when a buyer pays.
 */
const MANUAL_DEPOSIT_KIND = 'manual-deposit';
const GATEWAY_TOPUP_KIND = 'gateway-topup';

const ALLOWED_WALLET_META_KEYS = new Set([
  'kind',
  'phase',
  'description',
  'orderId',
  'listingId',
  'listingTitle',
  'auctionId',
  'refundReason',
  'debitReason',
  'receiptImageUrl',
  'rejectionReason',
  'adminNote',
  'repairTrackingCode',
  'paymentSource',
  'settlementKind',
  'agreementAmount',
]);

export type UserWalletTxFilter =
  | 'ALL'
  | 'INCOME'
  | 'EXPENSE'
  | 'BLOCKED'
  | 'PENDING';

type WalletTxnRow = {
  id: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;
  amount: unknown;
  referenceId: string | null;
  createdAt: Date;
  meta: unknown;
};

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  private async notifyWalletRefund(params: {
    userId: string;
    amount: number;
    orderId?: string;
    listingId?: string;
    listingTitle?: string;
    description?: string;
  }): Promise<void> {
    if (params.amount <= 0) return;
    try {
      await this.notificationService.create({
        userId: params.userId,
        type: NotificationType.WALLET_REFUND,
        title: 'بازگشت وجه به کیف پول',
        message:
          params.description ??
          `${params.amount.toLocaleString('fa-IR')} تومان به موجودی کیف پول شما واریز شد.`,
        meta: {
          amount: params.amount,
          userId: params.userId,
          orderId: params.orderId,
          listingId: params.listingId,
          listingTitle: params.listingTitle,
        },
      });
    } catch {
      // notification must not block wallet flow
    }
  }

  /** آیا تراکنش پرداخت/تسویه به سفارش معاوضهٔ مشخص تعلق دارد؟ */
  private settlementBelongsToExchangeOrder(
    t: { referenceId: string | null; meta: unknown },
    params: { orderId: string; listingId: string },
  ): boolean {
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    const metaListingId = String(meta['listingId'] ?? '').trim();
    const metaOrderId = String(meta['orderId'] ?? '').trim();
    const ref = String(t.referenceId ?? '').trim();

    if (metaListingId && metaListingId !== params.listingId) {
      return false;
    }
    if (metaOrderId && metaOrderId !== params.orderId) {
      return false;
    }

    return (
      ref === params.orderId ||
      ref === params.listingId ||
      metaOrderId === params.orderId ||
      metaListingId === params.listingId
    );
  }

  /** عنوان آگهی برای توضیح تراکنش‌های امانی سفارش */
  private async listingTitleForWalletTx(
    prisma: Prisma.TransactionClient | PrismaService,
    listingId: string,
  ): Promise<string | undefined> {
    const listing = await prisma.listing.findUnique({
      where: { id: listingId },
      select: { title: true },
    });
    return listing?.title ?? undefined;
  }

  // =================================================================
  // CORE & FETCH METHODS
  // =================================================================

  private userVisibleTransactionWhere(
    walletId: string,
  ): Prisma.WalletTransactionWhereInput {
    return {
      walletId,
      NOT: {
        AND: [
          { type: WalletTransactionType.DEPOSIT },
          { meta: { path: ['kind'], equals: GATEWAY_TOPUP_KIND } },
          { status: { not: WalletTransactionStatus.SUCCESS } },
        ],
      },
    };
  }

  private isLegacyEscrowBlockedTxn(t: WalletTxnRow): boolean {
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    const description = String(meta['description'] ?? '').trim();
    const isPendingDeposit =
      t.type === WalletTransactionType.DEPOSIT &&
      t.status === WalletTransactionStatus.PENDING;
    const mentionsEscrow = description.includes('بلوکه');
    const orderLike =
      description.includes('سفارش') || description.includes('مزایده');
    return isPendingDeposit && mentionsEscrow && orderLike;
  }

  private isEscrowBlockedTxn(t: WalletTxnRow): boolean {
    const meta = (t.meta ?? {}) as Record<string, unknown>;
    const kind = meta['kind'];
    const phase = meta['phase'];
    if (
      (kind === 'order-escrow' || kind === 'auction-escrow') &&
      t.status === WalletTransactionStatus.PENDING &&
      (phase === 'seller_blocked' ||
        phase === 'buyer_settlement_blocked' ||
        phase === 'seller_settlement_blocked')
    ) {
      return true;
    }
    if (
      kind === 'gateway-escrow' &&
      t.type === WalletTransactionType.DEPOSIT &&
      t.status === WalletTransactionStatus.PENDING
    ) {
      return true;
    }
    return this.isLegacyEscrowBlockedTxn(t);
  }

  private isBlockedLikeTxn(t: WalletTxnRow): boolean {
    return t.type === WalletTransactionType.BLOCK || this.isEscrowBlockedTxn(t);
  }

  private isIncomeTxn(t: WalletTxnRow): boolean {
    if (this.isBlockedLikeTxn(t)) return false;
    return (
      (t.type === WalletTransactionType.DEPOSIT ||
        t.type === WalletTransactionType.UNBLOCK ||
        t.type === WalletTransactionType.REFUND) &&
      t.status !== WalletTransactionStatus.FAILED
    );
  }

  private isExpenseTxn(t: WalletTxnRow): boolean {
    if (this.isBlockedLikeTxn(t)) return false;
    return (
      (t.type === WalletTransactionType.WITHDRAW_PAID ||
        t.type === WalletTransactionType.WITHDRAW_REQUEST ||
        t.type === WalletTransactionType.SETTLEMENT ||
        t.type === WalletTransactionType.PENALTY) &&
      t.status !== WalletTransactionStatus.FAILED
    );
  }

  private buildUserWalletFilterWhere(
    filter: UserWalletTxFilter,
  ): Prisma.WalletTransactionWhereInput | null {
    switch (filter) {
      case 'INCOME':
        return {
          type: {
            in: [
              WalletTransactionType.DEPOSIT,
              WalletTransactionType.UNBLOCK,
              WalletTransactionType.REFUND,
            ],
          },
          status: { not: WalletTransactionStatus.FAILED },
          NOT: { type: WalletTransactionType.BLOCK },
        };
      case 'EXPENSE':
        return {
          type: {
            in: [
              WalletTransactionType.WITHDRAW_PAID,
              WalletTransactionType.WITHDRAW_REQUEST,
              WalletTransactionType.SETTLEMENT,
              WalletTransactionType.PENALTY,
            ],
          },
          status: { not: WalletTransactionStatus.FAILED },
        };
      case 'BLOCKED':
        return {
          OR: [
            { type: WalletTransactionType.BLOCK },
            {
              type: WalletTransactionType.DEPOSIT,
              status: WalletTransactionStatus.PENDING,
              meta: { path: ['kind'], equals: 'order-escrow' },
            },
            {
              type: WalletTransactionType.DEPOSIT,
              status: WalletTransactionStatus.PENDING,
              meta: { path: ['kind'], equals: 'auction-escrow' },
            },
            {
              type: WalletTransactionType.DEPOSIT,
              status: WalletTransactionStatus.PENDING,
              meta: { path: ['kind'], equals: 'gateway-escrow' },
            },
          ],
        };
      case 'PENDING':
        return {
          status: WalletTransactionStatus.PENDING,
          NOT: { type: WalletTransactionType.BLOCK },
        };
      default:
        return null;
    }
  }

  private shouldHideZeroSellerBlocked(t: WalletTxnRow): boolean {
    const meta = t.meta as Record<string, unknown> | null;
    return (
      t.type === WalletTransactionType.DEPOSIT &&
      Number(t.amount || 0) <= 0 &&
      !!meta &&
      meta['kind'] === 'order-escrow' &&
      meta['phase'] === 'seller_blocked'
    );
  }

  private async sanitizeTransactionsForUser(
    transactions: WalletTxnRow[],
    userId: string,
  ) {
    const sellerBlockedListingIds = transactions
      .filter((t) => {
        const meta = t.meta as Record<string, unknown> | null;
        return (
          !!meta &&
          meta['kind'] === 'order-escrow' &&
          meta['phase'] === 'seller_blocked' &&
          typeof meta['listingId'] === 'string'
        );
      })
      .map((t) => (t.meta as Record<string, unknown>)['listingId'] as string);

    const uniqueSellerBlockedListingIds = Array.from(
      new Set(sellerBlockedListingIds),
    );
    const exchangeOrdersForFix = uniqueSellerBlockedListingIds.length
      ? await this.prisma.order.findMany({
          where: {
            type: 'EXCHANGE' as any,
            listingId: { in: uniqueSellerBlockedListingIds },
            sellerId: userId,
          },
          select: {
            listingId: true,
            sellerRevenue: true,
            platformFee: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const exchangeOrderByListingId = new Map<
      string,
      { sellerRevenue: number; platformFee: number }
    >();
    for (const o of exchangeOrdersForFix) {
      if (!exchangeOrderByListingId.has(o.listingId)) {
        exchangeOrderByListingId.set(o.listingId, {
          sellerRevenue: Number(o.sellerRevenue || 0),
          platformFee: Number(o.platformFee || 0),
        });
      }
    }

    return transactions
      .filter((t) => !this.shouldHideZeroSellerBlocked(t))
      .map((t) => {
        let safeMeta: Record<string, unknown> | null = null;
        if (t.meta && typeof t.meta === 'object' && !Array.isArray(t.meta)) {
          safeMeta = {};
          for (const [k, v] of Object.entries(
            t.meta as Record<string, unknown>,
          )) {
            if (ALLOWED_WALLET_META_KEYS.has(k)) safeMeta[k] = v;
          }
        }
        let normalizedAmount = Number(t.amount || 0);
        const rawMeta = t.meta as Record<string, unknown> | null;
        if (
          rawMeta &&
          rawMeta['kind'] === 'order-escrow' &&
          rawMeta['phase'] === 'seller_blocked' &&
          typeof rawMeta['listingId'] === 'string'
        ) {
          const match = exchangeOrderByListingId.get(rawMeta['listingId']);
          if (
            match &&
            match.platformFee > 0 &&
            Math.abs(normalizedAmount - match.sellerRevenue) < 1
          ) {
            normalizedAmount = match.sellerRevenue + match.platformFee;
          }
        }
        return { ...t, amount: normalizedAmount, meta: safeMeta };
      });
  }

  private async getWalletStatsForUser(userId: string, walletId: string) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const monthTxs = await this.prisma.walletTransaction.findMany({
      where: {
        ...this.userVisibleTransactionWhere(walletId),
        createdAt: { gte: monthStart },
      },
      select: {
        id: true,
        type: true,
        status: true,
        amount: true,
        referenceId: true,
        createdAt: true,
        meta: true,
      },
    });

    const sanitizedMonth = await this.sanitizeTransactionsForUser(
      monthTxs,
      userId,
    );

    let incomeThisMonth = 0;
    let expenseThisMonth = 0;
    for (const t of sanitizedMonth) {
      const amount = Number(t.amount || 0);
      if (!Number.isFinite(amount)) continue;
      if (this.isIncomeTxn(t)) incomeThisMonth += amount;
      if (this.isExpenseTxn(t)) expenseThisMonth += amount;
    }

    const pendingCount = await this.prisma.walletTransaction.count({
      where: {
        ...this.userVisibleTransactionWhere(walletId),
        status: WalletTransactionStatus.PENDING,
        NOT: { type: WalletTransactionType.BLOCK },
      },
    });

    const totalTransactions = await this.prisma.walletTransaction.count({
      where: this.userVisibleTransactionWhere(walletId),
    });

    return {
      incomeThisMonth,
      expenseThisMonth,
      pendingCount,
      totalTransactions,
    };
  }

  private async ensureUserWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }
    return wallet;
  }

  async getWalletByUserId(userId: string) {
    const wallet = await this.ensureUserWallet(userId);
    const stats = await this.getWalletStatsForUser(userId, wallet.id);

    return {
      ...wallet,
      transactions: [],
      stats,
    };
  }

  async getUserWalletTransactions(
    userId: string,
    options: {
      page?: number;
      pageSize?: number;
      filter?: UserWalletTxFilter;
    } = {},
  ) {
    const wallet = await this.ensureUserWallet(userId);
    const page = Math.max(1, options.page ?? DEFAULT_PAGE);
    const pageSize = Math.min(50, Math.max(5, options.pageSize ?? DEFAULT_PAGE_SIZE));
    const filter = options.filter ?? 'ALL';

    const baseWhere = this.userVisibleTransactionWhere(wallet.id);
    const filterWhere = this.buildUserWalletFilterWhere(filter);
    const where: Prisma.WalletTransactionWhereInput = filterWhere
      ? { AND: [baseWhere, filterWhere] }
      : baseWhere;

    const [total, rows] = await Promise.all([
      this.prisma.walletTransaction.count({ where }),
      this.prisma.walletTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          status: true,
          amount: true,
          referenceId: true,
          createdAt: true,
          meta: true,
        },
      }),
    ]);

    let items = await this.sanitizeTransactionsForUser(rows, userId);

    if (filter === 'INCOME') {
      items = items.filter((t) => this.isIncomeTxn(t));
    } else if (filter === 'EXPENSE') {
      items = items.filter((t) => this.isExpenseTxn(t));
    } else if (filter === 'BLOCKED') {
      items = items.filter((t) => this.isBlockedLikeTxn(t));
    } else if (filter === 'PENDING') {
      items = items.filter(
        (t) =>
          t.status === WalletTransactionStatus.PENDING &&
          !this.isBlockedLikeTxn(t),
      );
    }

    return {
      items,
      pagination: buildPaginationMeta(page, pageSize, total),
    };
  }

  // =================================================================
  // AUCTION LOGIC
  // =================================================================

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

    const wallet = await this.getWalletByUserId(userId);

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
  async payAuctionFinal(
    buyerId: string,
    sellerId: string,
    totalAmount: number | string | Decimal,
    blockedDeposit: number | string | Decimal,
    platformFee: number | string | Decimal, // 👈 کارمزد اضافه شد
    refId: string,
    tx?: Prisma.TransactionClient,
    opts?: { orderId?: string },
  ) {
    const prisma = tx || this.prisma;
    const totalDec = new Decimal(totalAmount);
    const depositDec = new Decimal(blockedDeposit);
    const feeDec = new Decimal(platformFee);
    const remainderDec = totalDec.minus(depositDec);
    const sellerRevenue = totalDec.minus(feeDec); // سهم خالص فروشنده

    const buyerWallet = await prisma.wallet.findUnique({
      where: { userId: buyerId },
    });
    if (!buyerWallet) throw new BadRequestException('کیف پول خریدار یافت نشد');

    if (
      remainderDec.gt(0) &&
      new Decimal(buyerWallet.balanceAvailable).lt(remainderDec)
    ) {
      throw new BadRequestException(
        'موجودی آزاد برای پرداخت مابه‌تفاوت کافی نیست',
      );
    }

    if (depositDec.gt(0)) {
      const bidScoped = await this.getAuctionBidDepositScopedBlocked(prisma, {
        userId: buyerId,
        listingId: refId,
      });
      const depositToRelease = Decimal.min(depositDec, new Decimal(bidScoped));
      if (depositToRelease.gt(0)) {
        await prisma.wallet.update({
          where: { userId: buyerId },
          data: { balanceBlocked: { decrement: depositToRelease.toString() } },
        });
        const buyerWallet = await prisma.wallet.findUnique({
          where: { userId: buyerId },
        });
        if (buyerWallet) {
          await prisma.walletTransaction.create({
            data: {
              walletId: buyerWallet.id,
              amount: depositToRelease.toNumber(),
              type: WalletTransactionType.UNBLOCK,
              status: WalletTransactionStatus.SUCCESS,
              referenceId: refId,
              meta: {
                kind: 'auction-bid-deposit',
                listingId: refId,
                phase: 'deposit_applied_to_final_payment',
                description:
                  'ودیعهٔ بلوکه‌شدهٔ مزایده برای پرداخت نهایی آزاد شد',
              },
            },
          });
        }
      }
    }

    const auctionListingTitle = await this.listingTitleForWalletTx(
      prisma,
      refId,
    );

    if (remainderDec.gt(0)) {
      await prisma.wallet.update({
        where: { userId: buyerId },
        data: { balanceAvailable: { decrement: remainderDec.toString() } },
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          amount: remainderDec.toNumber(),
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: refId,
          meta: {
            kind: 'auction-escrow',
            phase: 'buyer_remainder',
            listingId: refId,
            ...(auctionListingTitle
              ? { listingTitle: auctionListingTitle }
              : {}),
            description: auctionListingTitle
              ? `پرداخت مابه‌التفاوت مزایده از کیف پول — «${auctionListingTitle}». این مبلغ برای تکمیل خرید از ودیعه قبلی کسر شد.`
              : 'پرداخت مابه‌التفاوت مزایده از کیف پول؛ برای تکمیل خرید پس از برنده شدن.',
          },
        },
      });
    }

    // پول به جای آزاد شدن، برای فروشنده بلوکه می‌شود تا کالا به دست خریدار برسد
    let sellerWallet = await prisma.wallet.findUnique({
      where: { userId: sellerId },
    });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({
        data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }

    await prisma.wallet.update({
      where: { userId: sellerId },
      data: { balanceBlocked: { increment: sellerRevenue.toString() } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        amount: sellerRevenue.toNumber(),
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING, // وضعیت پندینگ برای اسکرو
        referenceId: refId,
        meta: {
          kind: 'auction-escrow',
          phase: 'seller_blocked',
          listingId: refId,
          ...(opts?.orderId ? { orderId: opts.orderId } : {}),
          ...(auctionListingTitle ? { listingTitle: auctionListingTitle } : {}),
          description: auctionListingTitle
            ? `درآمد فروش مزایده بلوکه است تا خریدار دریافت کالا را تأیید کند — «${auctionListingTitle}». پس از تأیید، به موجودی قابل برداشت منتقل می‌شود.`
            : 'درآمد فروش مزایده بلوکه است تا خریدار دریافت را تأیید کند؛ سپس آزاد می‌شود.',
        },
      },
    });
  }

  /**
   * تسویه مزایده پس از پرداخت موفق درگاه: ودیعه از بلوکه خریدار آزاد می‌شود
   * و سهم فروشنده (شامل سهم ودیعه + مبلغ درگاه) در کیف پول فروشنده بلوکه می‌شود.
   */
  async settleAuctionGatewayPayment(
    params: {
      buyerId: string;
      sellerId: string;
      listingId: string;
      gatewayPaidAmount: number;
      sellerRevenue: number;
      blockedDeposit: number;
      listingTitle?: string;
      orderId?: string;
    },
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const {
      buyerId,
      sellerId,
      listingId,
      gatewayPaidAmount,
      sellerRevenue,
      blockedDeposit,
      listingTitle,
      orderId,
    } = params;

    const depositDec = new Decimal(blockedDeposit);
    const sellerRevDec = new Decimal(sellerRevenue);
    const gatewayDec = new Decimal(gatewayPaidAmount);

    if (depositDec.gt(0)) {
      const buyerWallet = await prisma.wallet.findUnique({
        where: { userId: buyerId },
      });
      if (!buyerWallet) {
        throw new BadRequestException('کیف پول خریدار یافت نشد');
      }
      const bidScoped = await this.getAuctionBidDepositScopedBlocked(prisma, {
        userId: buyerId,
        listingId,
      });
      const depositToRelease = Math.min(
        depositDec.toNumber(),
        bidScoped,
      );
      if (depositToRelease <= 0) {
        throw new BadRequestException(
          'ودیعه بلوکه‌شدهٔ این مزایده برای تسویه کافی نیست',
        );
      }
      await prisma.wallet.update({
        where: { userId: buyerId },
        data: { balanceBlocked: { decrement: depositToRelease } },
      });
      await prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          amount: depositToRelease,
          type: WalletTransactionType.UNBLOCK,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: listingId,
          meta: {
            kind: 'auction-bid-deposit',
            listingId,
            phase: 'deposit_applied_to_gateway_payment',
            ...(orderId ? { orderId } : {}),
            description:
              'ودیعهٔ بلوکه‌شدهٔ مزایده برای پرداخت درگاهی آزاد شد',
          },
        },
      });
    }

    if (sellerRevDec.gt(0)) {
      let sellerWallet = await prisma.wallet.findUnique({
        where: { userId: sellerId },
      });
      if (!sellerWallet) {
        sellerWallet = await prisma.wallet.create({
          data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 },
        });
      }
      await prisma.wallet.update({
        where: { userId: sellerId },
        data: { balanceBlocked: { increment: sellerRevDec.toString() } },
      });

      const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';
      await prisma.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          amount: sellerRevDec.toNumber(),
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          referenceId: listingId,
          meta: {
            kind: 'auction-escrow',
            phase: 'seller_blocked',
            paymentSource: 'GATEWAY',
            listingId,
            ...(orderId ? { orderId } : {}),
            ...(listingTitle ? { listingTitle } : {}),
            description: `درآمد فروش مزایده برای ${titleQuoted} از درگاه و ودیعه بلوکه شد.`,
          },
        },
      });
    }

    if (gatewayDec.gt(0)) {
      const buyerWallet = await prisma.wallet.upsert({
        where: { userId: buyerId },
        create: {
          userId: buyerId,
          balanceAvailable: 0,
          balanceBlocked: 0,
        },
        update: {},
      });
      await prisma.walletTransaction.create({
        data: {
          walletId: buyerWallet.id,
          amount: gatewayDec.toNumber(),
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: listingId,
          meta: {
            kind: 'auction-escrow',
            phase: 'buyer_gateway',
            paymentSource: 'GATEWAY',
            listingId,
            ...(listingTitle ? { listingTitle } : {}),
            description: listingTitle
              ? `پرداخت مابه‌التفاوت مزایده از درگاه — «${listingTitle}».`
              : 'پرداخت مابه‌التفاوت مزایده از درگاه.',
          },
        },
      });
    }
  }

  // =================================================================
  // ESCROW LOGIC (Direct Buy & Exchange)
  // =================================================================

  // ✅ اصلاح شد: اضافه شدن کارمزد پلتفرم (Platform Fee)
  async transferToEscrow(
    buyerId: string,
    sellerId: string,
    amount: number | string | Decimal,
    platformFee: number | string | Decimal,
    refId: string,
    tx?: Prisma.TransactionClient,
    opts?: {
      isExchangeEscrow?: boolean;
      blockedAmount?: number | string | Decimal;
      orderId?: string;
    },
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const feeDec = new Decimal(platformFee);
    const blockedAmountDec =
      opts?.blockedAmount !== undefined
        ? new Decimal(opts.blockedAmount)
        : amountDec.minus(feeDec);
    const sellerRevenue = blockedAmountDec;
    const isExchangeEscrow = Boolean(opts?.isExchangeEscrow);
    const listingTitle = await this.listingTitleForWalletTx(prisma, refId);
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';

    const buyerWallet = await prisma.wallet.findUnique({
      where: { userId: buyerId },
    });

    if (
      !buyerWallet ||
      new Decimal(buyerWallet.balanceAvailable).lt(amountDec)
    ) {
      throw new BadRequestException('موجودی کیف پول برای خرید کافی نیست');
    }
    if (blockedAmountDec.lt(0)) {
      throw new BadRequestException('مبلغ بلوکه فروشنده نامعتبر است');
    }
    if (blockedAmountDec.gt(amountDec)) {
      throw new BadRequestException(
        'مبلغ بلوکه فروشنده نمی‌تواند بیشتر از مبلغ پرداختی باشد',
      );
    }

    await prisma.wallet.update({
      where: { userId: buyerId },
      data: { balanceAvailable: { decrement: amountDec.toString() } },
    });

    await prisma.walletTransaction.create({
      data: {
        walletId: buyerWallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.SETTLEMENT,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: refId,
        meta: {
          kind: 'order-escrow',
          phase: isExchangeEscrow ? 'exchange_participant_paid' : 'buyer_paid',
          ...(isExchangeEscrow ? { payerUserId: buyerId } : {}),
          listingId: refId,
          ...(opts?.orderId ? { orderId: opts.orderId } : {}),
          ...(listingTitle ? { listingTitle } : {}),
          paymentSource: 'WALLET',
          description: isExchangeEscrow
            ? `پرداخت سهم معاوضه (کارشناسی/مابه‌التفاوت) برای ${titleQuoted} از کیف پول ثبت شد.`
            : `پرداخت خرید برای ${titleQuoted} از کیف پول ثبت شد.`,
        },
      },
    });

    let sellerWallet = await prisma.wallet.findUnique({
      where: { userId: sellerId },
    });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({
        data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }

    // اگر سهم فروشنده صفر باشد (مثلاً در برخی سناریوهای معاوضه)،
    // نباید تراکنش واریزی ۰ ثبت شود.
    if (sellerRevenue.gt(0)) {
      await prisma.wallet.update({
        where: { userId: sellerId },
        data: { balanceBlocked: { increment: sellerRevenue.toString() } },
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          amount: sellerRevenue.toNumber(),
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          referenceId: refId,
          meta: {
            kind: 'order-escrow',
            phase: 'seller_blocked',
            listingId: refId,
            ...(opts?.orderId ? { orderId: opts.orderId } : {}),
            ...(listingTitle ? { listingTitle } : {}),
            description: isExchangeEscrow
              ? `مبلغ امانی معاوضه برای ${titleQuoted} در کیف پول شما بلوکه شد و پس از تایید نهایی طرفین آزاد می‌شود.`
              : `سهم فروش شما برای ${titleQuoted} به کیف پول واریز شد و تا تایید دریافت توسط خریدار، در حالت بلوکه است.`,
          },
        },
      });
    }
  }

  /**
   * Credits seller escrow from an external gateway payment (no buyer wallet debit).
   * Used only after gateway verification succeeds.
   */
  async creditExternalPaymentToEscrow(
    sellerId: string,
    amount: number | string | Decimal,
    platformFee: number | string | Decimal,
    refId: string,
    tx?: Prisma.TransactionClient,
    opts?: {
      isExchangeEscrow?: boolean;
      blockedAmount?: number | string | Decimal;
      orderId?: string;
    },
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const feeDec = new Decimal(platformFee);
    const blockedAmountDec =
      opts?.blockedAmount !== undefined
        ? new Decimal(opts.blockedAmount)
        : amountDec.minus(feeDec);
    const sellerRevenue = blockedAmountDec;

    if (amountDec.lte(0)) {
      throw new BadRequestException('مبلغ پرداخت نامعتبر است');
    }
    if (blockedAmountDec.lt(0)) {
      throw new BadRequestException('مبلغ بلوکه فروشنده نامعتبر است');
    }
    if (blockedAmountDec.gt(amountDec)) {
      throw new BadRequestException(
        'مبلغ بلوکه فروشنده نمی‌تواند بیشتر از مبلغ پرداختی باشد',
      );
    }
    if (sellerRevenue.lt(0)) {
      throw new BadRequestException('کارمزد از مبلغ پرداخت بیشتر است');
    }

    let sellerWallet = await prisma.wallet.findUnique({
      where: { userId: sellerId },
    });
    if (!sellerWallet) {
      sellerWallet = await prisma.wallet.create({
        data: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }

    const isExchangeEscrow = Boolean(opts?.isExchangeEscrow);
    const listingTitle = await this.listingTitleForWalletTx(prisma, refId);
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';

    // ثبت تراکنش فروشنده فقط وقتی سهم واقعی > 0 باشد
    if (sellerRevenue.gt(0)) {
      await prisma.wallet.update({
        where: { userId: sellerId },
        data: { balanceBlocked: { increment: sellerRevenue.toString() } },
      });

      await prisma.walletTransaction.create({
        data: {
          walletId: sellerWallet.id,
          amount: sellerRevenue.toNumber(),
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          referenceId: refId,
          meta: {
            kind: 'order-escrow',
            phase: 'seller_blocked',
            listingId: refId,
            ...(opts?.orderId ? { orderId: opts.orderId } : {}),
            ...(listingTitle ? { listingTitle } : {}),
            paymentSource: 'GATEWAY',
            description: isExchangeEscrow
              ? `پرداخت امانی معاوضه از درگاه برای ${titleQuoted} ثبت شد و مبلغ مربوطه در کیف پول شما بلوکه شد.`
              : `پرداخت خریدار از درگاه برای ${titleQuoted} ثبت شد و سهم فروش شما در کیف پول به‌صورت بلوکه قرار گرفت.`,
          },
        },
      });
    }
  }

  /**
   * حداکثر مبلغی که برای یک سفارش می‌توان از بلوکه آزاد یا کسر کرد (بر اساس DEPOSITهای PENDING همان سفارش).
   */
  async resolveOrderScopedCap(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      orderId: string;
      listingId: string;
      requestedAmount: number | string | Decimal;
    },
  ): Promise<number> {
    const requested = Math.max(0, Number(new Decimal(params.requestedAmount)) || 0);
    if (requested <= 0) return 0;
    const scoped = await this.getOrderScopedBlockedAmount(tx, {
      userId: params.userId,
      orderId: params.orderId,
      listingId: params.listingId,
    });
    return Math.min(requested, scoped);
  }

  /**
   * کسر از balanceBlocked فقط تا سقف بلوکهٔ همان سفارش (جلوگیری از دست زدن به معاملات دیگر).
   */
  async debitOrderScopedBlocked(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      orderId: string;
      listingId: string;
      requestedAmount: number | string | Decimal;
      penaltyMeta: Prisma.InputJsonValue;
      referenceId?: string;
    },
  ): Promise<number> {
    const amount = await this.resolveOrderScopedCap(tx, {
      userId: params.userId,
      orderId: params.orderId,
      listingId: params.listingId,
      requestedAmount: params.requestedAmount,
    });
    if (amount <= 0) return 0;

    const sellerWallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        balanceAvailable: 0,
        balanceBlocked: 0,
      },
      update: { balanceBlocked: { decrement: amount } },
      select: { id: true },
    });

    await tx.walletTransaction.create({
      data: {
        walletId: sellerWallet.id,
        amount,
        type: WalletTransactionType.PENALTY,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: params.referenceId ?? params.orderId,
        meta: params.penaltyMeta,
      },
    });
    return amount;
  }

  async releaseEscrow(
    sellerId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
    opts?: { orderId?: string },
  ) {
    const prisma = tx || this.prisma;
    let amountDec = new Decimal(amount);
    if (opts?.orderId) {
      const capped = await this.resolveOrderScopedCap(prisma, {
        userId: sellerId,
        orderId: opts.orderId,
        listingId,
        requestedAmount: amountDec,
      });
      amountDec = new Decimal(capped);
    }
    if (amountDec.lte(0)) return;

    const wallet = await this.getWalletByUserId(sellerId);
    const listingTitle = await this.listingTitleForWalletTx(prisma, listingId);
    const titleQuoted = listingTitle ? `«${listingTitle}»` : 'این آگهی';

    await prisma.wallet.update({
      where: { userId: sellerId },
      data: {
        balanceBlocked: { decrement: amountDec.toString() },
        balanceAvailable: { increment: amountDec.toString() },
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
          kind: 'order-escrow',
          phase: 'seller_released',
          listingId,
          ...(listingTitle ? { listingTitle } : {}),
          ...(opts?.orderId ? { orderId: opts.orderId } : {}),
          description: `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون خریدار دریافت کالا را تأیید کرد.`,
        },
      },
    });
  }

  private escrowDepositBelongsToOrder(
    meta: Record<string, unknown>,
    params: { orderId: string; listingId: string },
  ): boolean {
    const metaOrderId = String(meta['orderId'] ?? '').trim();
    const metaListingId = String(meta['listingId'] ?? '').trim();
    if (metaOrderId) return metaOrderId === params.orderId;
    if (metaListingId) return metaListingId === params.listingId;
    return true;
  }

  /**
   * پس از ایجاد سفارش، DEPOSITهای امانی همان listing که هنوز orderId ندارند را به سفارش وصل می‌کند.
   */
  async linkEscrowDepositsToOrder(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      listingId: string;
      userIds: string[];
    },
  ): Promise<void> {
    const escrowKinds = new Set(['order-escrow', 'auction-escrow']);
    for (const userId of params.userIds) {
      const wallet = await tx.wallet.findUnique({
        where: { userId },
        select: { id: true },
      });
      if (!wallet) continue;

      const pending = await tx.walletTransaction.findMany({
        where: {
          walletId: wallet.id,
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          referenceId: { in: [params.orderId, params.listingId] },
        },
        select: { id: true, meta: true },
      });

      for (const row of pending) {
        const meta = { ...((row.meta ?? {}) as Record<string, unknown>) };
        const kind = String(meta['kind'] ?? '').trim();
        if (!escrowKinds.has(kind)) continue;
        if (String(meta['orderId'] ?? '').trim()) continue;
        if (
          String(meta['listingId'] ?? params.listingId).trim() !==
          params.listingId
        ) {
          continue;
        }
        meta['orderId'] = params.orderId;
        meta['listingId'] = params.listingId;
        await tx.walletTransaction.update({
          where: { id: row.id },
          data: { meta: meta as Prisma.InputJsonValue },
        });
      }
    }
  }

  /**
   * مجموع مبلغ بلوکه‌شدهٔ مربوط به یک سفارش مشخص برای یک کاربر.
   * فقط DEPOSITهای PENDING همان سفارش/آگهی شمرده می‌شوند تا عملیات یک سفارش
   * روی بلوکهٔ سفارش دیگر اثر نگذارد.
   */
  async getOrderScopedBlockedAmount(
    tx: Prisma.TransactionClient,
    params: { userId: string; orderId: string; listingId: string },
  ): Promise<number> {
    const wallet = await tx.wallet.findUnique({
      where: { userId: params.userId },
      select: { id: true },
    });
    if (!wallet) return 0;

    const pendingDeposits = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        OR: [
          { referenceId: params.orderId },
          { referenceId: params.listingId },
        ],
      },
      select: { amount: true, meta: true, referenceId: true },
    });

    const orderEscrowPhases = new Set([
      'seller_blocked',
      'buyer_settlement_blocked',
      'seller_settlement_blocked',
      'shipping_blocked',
    ]);
    const auctionEscrowPhases = new Set(['seller_blocked', 'shipping_blocked']);

    let scopedBlocked = 0;
    for (const row of pendingDeposits) {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const kind = String(meta['kind'] ?? 'order-escrow').trim();
      const phase = String(meta['phase'] ?? '').trim();

      if (kind === 'order-escrow') {
        if (!orderEscrowPhases.has(phase)) continue;
      } else if (kind === 'auction-escrow') {
        if (!auctionEscrowPhases.has(phase)) continue;
      } else {
        continue;
      }

      if (!this.escrowDepositBelongsToOrder(meta, params)) continue;

      scopedBlocked += Math.max(0, Number(row.amount) || 0);
    }
    return scopedBlocked;
  }

  /** مبلغ قابل بازگشت به خریدار از روی سفارش یا تراکنش پرداخت ثبت‌شده */
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
      if (!this.settlementBelongsToExchangeOrder(t, params)) {
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
      if (!this.settlementBelongsToExchangeOrder(t, params)) continue;
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
    const listingTitle = await this.listingTitleForWalletTx(
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
    const listingTitle = await this.listingTitleForWalletTx(
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
        const debited = await this.debitOrderScopedBlocked(tx, {
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
            description: `لغو معامله برای ${titleQuoted}: مبلغ بلوکه‌شده از کیف پول شما برداشته شد چون سفارش لغو شد (${params.cancelReason}).`,
          },
        });
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
              return this.escrowDepositBelongsToOrder(meta, {
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
        void this.notifyWalletRefund({
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
      const peerDebit = await this.debitOrderScopedBlocked(tx, {
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
          void this.notifyWalletRefund({
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
      const peerDebit = await this.debitOrderScopedBlocked(tx, {
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
          void this.notifyWalletRefund({
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

    const listingTitle = await this.listingTitleForWalletTx(
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
    void this.notifyWalletRefund({
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
    const listingTitle = await this.listingTitleForWalletTx(
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
    const listingTitle = await this.listingTitleForWalletTx(
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
    void this.notifyWalletRefund({
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
    const listingTitle = await this.listingTitleForWalletTx(
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
    const listingTitle = await this.listingTitleForWalletTx(
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

  // =================================================================
  // STANDARD METHODS (Deposit / Withdraw / Admin)
  // =================================================================

  async deposit(userId: string, amount: number | string | Decimal) {
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

  // ==========================================================
  // MANUAL (CARD-TO-CARD / BANK-TRANSFER) DEPOSIT REQUESTS
  // ==========================================================

  /**
   * User-initiated wallet charge request. The wallet balance is NOT
   * credited here – the transaction is created in PENDING state and
   * must be approved by an admin after reviewing the receipt image.
   */
  async requestDeposit(
    userId: string,
    dto: {
      amount: number | string;
      receiptImage?: string | null;
      trackingCode?: string | null;
      description?: string | null;
    },
  ) {
    const amountDec = new Decimal(dto.amount);
    if (amountDec.lte(0)) throw new BadRequestException('مبلغ نامعتبر است');
    if (amountDec.lt(10000)) {
      throw new BadRequestException('حداقل مبلغ شارژ ۱۰,۰۰۰ تومان است');
    }

    const wallet = await this.getWalletByUserId(userId);

    const created = await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: amountDec.toNumber(),
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        meta: {
          kind: MANUAL_DEPOSIT_KIND,
          paymentSource: 'MANUAL_TRANSFER',
          description: dto.description ?? 'درخواست شارژ کیف پول',
          receiptImage: dto.receiptImage ?? null,
          trackingCode: dto.trackingCode ?? null,
        },
      },
    });

    await this.notificationService.create({
      userId,
      type: NotificationType.WALLET_DEPOSIT_SUBMITTED,
      title: 'درخواست شارژ دستی ثبت شد',
      message:
        'درخواست شما ثبت شد و پس از بررسی ادمین، نتیجه از همین بخش اطلاع‌رسانی می‌شود.',
      meta: {
        transactionId: created.id,
        amount: amountDec.toNumber(),
        userId,
        kind: MANUAL_DEPOSIT_KIND,
      },
    });

    void this.notificationService
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_WALLET_DEPOSIT,
        title: 'درخواست شارژ کیف پول',
        message: `درخواست شارژ دستی جدید به مبلغ ${amountDec.toNumber().toLocaleString('fa-IR')} تومان ثبت شد.`,
        meta: {
          transactionId: created.id,
          amount: amountDec.toNumber(),
          userId,
        },
      })
      .catch(() => undefined);

    return created;
  }

  async getDepositRequestsAdmin(
    params: {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
      page?: number;
      pageSize?: number;
      search?: string;
    } = {},
  ) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 20));
    const statusFilter = this.resolveStatusFilter(params.status);

    const where: Prisma.WalletTransactionWhereInput = {
      type: WalletTransactionType.DEPOSIT,
      ...statusFilter,
      meta: { path: ['kind'], equals: MANUAL_DEPOSIT_KIND },
    };

    if (params.search) {
      const q = params.search.trim();
      where.wallet = {
        user: {
          OR: [
            { phone: { contains: q } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: {
            include: {
              user: {
                select: {
                  id: true,
                  phone: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  async processDeposit(
    transactionId: string,
    action: 'APPROVE' | 'REJECT',
    adminNote?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
      });
      if (!transaction) throw new NotFoundException('تراکنش یافت نشد');

      const meta = (transaction.meta ?? {}) as Record<string, unknown>;
      if (
        transaction.type !== WalletTransactionType.DEPOSIT ||
        meta.kind !== MANUAL_DEPOSIT_KIND
      ) {
        throw new BadRequestException('این تراکنش یک درخواست شارژ دستی نیست');
      }
      if (transaction.status !== WalletTransactionStatus.PENDING) {
        throw new BadRequestException('این درخواست قبلاً پردازش شده است');
      }

      const amountDec = new Decimal(transaction.amount);

      if (action === 'APPROVE') {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balanceAvailable: { increment: amountDec.toString() } },
        });
        await tx.walletTransaction.update({
          where: { id: transactionId },
          data: {
            status: WalletTransactionStatus.SUCCESS,
            meta: {
              ...meta,
              adminNote: adminNote ?? null,
              approvedAt: new Date().toISOString(),
            },
          },
        });
        const txWithUser = await tx.walletTransaction.findUnique({
          where: { id: transactionId },
          select: { wallet: { select: { userId: true } } },
        });
        if (txWithUser?.wallet?.userId) {
          await this.notificationService.create({
            userId: txWithUser.wallet.userId,
            type: NotificationType.WALLET_DEPOSIT_APPROVED,
            title: 'شارژ کیف پول تایید شد',
            message:
              'درخواست شارژ دستی شما تایید شد و مبلغ به موجودی قابل برداشت اضافه شد.',
            meta: {
              transactionId,
              amount: amountDec.toNumber(),
              userId: txWithUser.wallet.userId,
            },
          });
        }

        return { message: 'درخواست شارژ تایید و مبلغ به کیف پول اضافه شد' };
      }

      await tx.walletTransaction.update({
        where: { id: transactionId },
        data: {
          status: WalletTransactionStatus.FAILED,
          meta: {
            ...meta,
            adminNote: adminNote ?? null,
            rejectionReason: adminNote ?? 'رد توسط ادمین',
            rejectedAt: new Date().toISOString(),
          },
        },
      });

      const txWithUser = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
        select: { wallet: { select: { userId: true } } },
      });
      if (txWithUser?.wallet?.userId) {
        await this.notificationService.create({
          userId: txWithUser.wallet.userId,
          type: NotificationType.WALLET_DEPOSIT_REJECTED,
          title: 'درخواست شارژ دستی رد شد',
          message: adminNote
            ? `درخواست شارژ شما رد شد. دلیل: ${adminNote}`
            : 'درخواست شارژ شما توسط ادمین رد شد.',
          meta: {
            transactionId,
            amount: amountDec.toNumber(),
            userId: txWithUser.wallet.userId,
            rejectionReason: adminNote ?? 'رد توسط ادمین',
          },
        });
      }
      return { message: 'درخواست شارژ رد شد' };
    });
  }

  private resolveStatusFilter(
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL',
  ): Pick<Prisma.WalletTransactionWhereInput, 'status'> {
    switch (status) {
      case 'APPROVED':
        return { status: WalletTransactionStatus.SUCCESS };
      case 'REJECTED':
        return { status: WalletTransactionStatus.FAILED };
      case 'ALL':
        return {};
      case 'PENDING':
      default:
        return { status: WalletTransactionStatus.PENDING };
    }
  }

  async requestWithdraw(userId: string, dto: any) {
    const amountDec = new Decimal(dto.amount);
    const wallet = await this.getWalletByUserId(userId);

    if (new Decimal(wallet.balanceAvailable).lt(amountDec)) {
      throw new BadRequestException('موجودی قابل برداشت کافی نیست');
    }

    const created = await this.prisma.$transaction(async (tx) => {
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

    await this.notificationService.create({
      userId,
      type: NotificationType.WALLET_WITHDRAW_SUBMITTED,
      title: 'درخواست برداشت ثبت شد',
      message:
        'درخواست برداشت شما ثبت شد و پس از بررسی ادمین، نتیجه اطلاع‌رسانی می‌شود.',
      meta: {
        transactionId: created.id,
        amount: amountDec.toNumber(),
        userId,
      },
    });

    void this.notificationService
      .notifyAdminPersonnel({
        type: NotificationType.ADMIN_ALERT_WALLET_WITHDRAW,
        title: 'درخواست برداشت کیف پول',
        message: `درخواست برداشت جدید به مبلغ ${amountDec.toNumber().toLocaleString('fa-IR')} تومان ثبت شد.`,
        meta: {
          transactionId: created.id,
          amount: amountDec.toNumber(),
          userId,
        },
      })
      .catch(() => undefined);

    return created;
  }

  async getWithdrawRequestsAdmin(
    params: {
      status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
      page?: number;
      pageSize?: number;
      search?: string;
    } = {},
  ) {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(5, params.pageSize ?? 20));
    const statusCfg = this.resolveWithdrawFilter(params.status);

    const where: Prisma.WalletTransactionWhereInput = {
      ...statusCfg,
    };

    if (params.search) {
      const q = params.search.trim();
      where.wallet = {
        user: {
          OR: [
            { phone: { contains: q } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
          ],
        },
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.walletTransaction.findMany({
        where,
        include: {
          wallet: {
            include: {
              user: {
                select: {
                  id: true,
                  phone: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                  shabaNumber: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.walletTransaction.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    };
  }

  private resolveWithdrawFilter(
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL',
  ): Pick<Prisma.WalletTransactionWhereInput, 'type' | 'status' | 'OR'> {
    switch (status) {
      case 'APPROVED':
        return {
          type: WalletTransactionType.WITHDRAW_PAID,
          status: WalletTransactionStatus.SUCCESS,
        };
      case 'REJECTED':
        return {
          type: WalletTransactionType.WITHDRAW_REQUEST,
          status: WalletTransactionStatus.FAILED,
        };
      case 'ALL':
        return {
          OR: [
            { type: WalletTransactionType.WITHDRAW_REQUEST },
            { type: WalletTransactionType.WITHDRAW_PAID },
          ],
        };
      case 'PENDING':
      default:
        return {
          type: WalletTransactionType.WITHDRAW_REQUEST,
          status: WalletTransactionStatus.PENDING,
        };
    }
  }

  async processWithdraw(
    transactionId: string,
    action: 'APPROVE' | 'REJECT',
    adminNote?: string,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
        include: { wallet: { select: { userId: true } } },
      });

      if (
        !transaction ||
        transaction.status !== WalletTransactionStatus.PENDING
      ) {
        throw new BadRequestException('تراکنش نامعتبر است یا قبلا پردازش شده');
      }

      const amountDec = new Decimal(transaction.amount);
      const userId = transaction.wallet.userId;

      if (action === 'APPROVE') {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balanceBlocked: { decrement: amountDec.toString() } },
        });

        await tx.walletTransaction.update({
          where: { id: transactionId },
          data: {
            status: WalletTransactionStatus.SUCCESS,
            type: WalletTransactionType.WITHDRAW_PAID,
            meta: {
              ...(transaction.meta as object),
              adminNote,
              approvedAt: new Date(),
            },
          },
        });

        return {
          message: 'درخواست برداشت تایید و مبلغ کسر شد',
          userId,
          amount: amountDec.toNumber(),
          approved: true as const,
        };
      }

      await tx.wallet.update({
        where: { id: transaction.walletId },
        data: {
          balanceBlocked: { decrement: amountDec.toString() },
          balanceAvailable: { increment: amountDec.toString() },
        },
      });

      await tx.walletTransaction.update({
        where: { id: transactionId },
        data: {
          status: WalletTransactionStatus.FAILED,
          meta: {
            ...(transaction.meta as object),
            adminNote,
            rejectionReason: adminNote ?? 'رد توسط ادمین',
          },
        },
      });

      return {
        message: 'درخواست رد شد و مبلغ به کیف پول بازگشت',
        userId,
        amount: amountDec.toNumber(),
        approved: false as const,
      };
    });

    if (result.approved) {
      await this.notificationService.create({
        userId: result.userId,
        type: NotificationType.WALLET_WITHDRAW_APPROVED,
        title: 'برداشت وجه تایید شد',
        message: 'درخواست برداشت شما تایید شد و مبلغ از کیف پول کسر شد.',
        meta: {
          transactionId,
          amount: result.amount,
          userId: result.userId,
        },
      });
    } else {
      await this.notificationService.create({
        userId: result.userId,
        type: NotificationType.WALLET_WITHDRAW_REJECTED,
        title: 'درخواست برداشت رد شد',
        message: adminNote
          ? `درخواست برداشت شما رد شد. دلیل: ${adminNote}`
          : 'درخواست برداشت شما توسط ادمین رد شد و مبلغ به موجودی بازگشت.',
        meta: {
          transactionId,
          amount: result.amount,
          userId: result.userId,
          rejectionReason: adminNote ?? 'رد توسط ادمین',
        },
      });
    }

    return { message: result.message };
  }
  async payFromAvailable(
    userId: string,
    amount: number | string | Decimal,
    referenceId: string,
    tx?: Prisma.TransactionClient,
  ) {
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
}
