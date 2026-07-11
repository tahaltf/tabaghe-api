import {
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  Prisma,
} from '@prisma/client';
import {
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '../../../../shared/contracts/pagination';
import {
  ALLOWED_WALLET_META_KEYS,
  GATEWAY_TOPUP_KIND,
  ORPHAN_PLATFORM_FEE_CLEAR_PHASE,
  UserWalletTxFilter,
  WALLET_RECONCILE_KIND,
  WalletTxnRow,
} from '../../wallet.constants';
import { WalletSupportService } from '../support/wallet-support.service';

const ESCROW_HOLD_KINDS = new Set([
  'order-escrow',
  'auction-escrow',
  'gateway-escrow',
]);

@Injectable()
export class WalletQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
  ) {}

  private userVisibleTransactionWhere(
    walletId: string,
  ): Prisma.WalletTransactionWhereInput {
    return {
      walletId,
      NOT: {
        OR: [
          {
            AND: [
              { type: WalletTransactionType.DEPOSIT },
              { meta: { path: ['kind'], equals: GATEWAY_TOPUP_KIND } },
              { status: { not: WalletTransactionStatus.SUCCESS } },
            ],
          },
          {
            AND: [
              { type: WalletTransactionType.COMMISSION_FEE },
              { meta: { path: ['kind'], equals: WALLET_RECONCILE_KIND } },
            ],
          },
        ],
      },
    };
  }

  /**
   * تراکنش‌های «در حال انجام» واقعی (مثلاً برداشت/واریز دستی در صف ادمین).
   * امانت/بلوکه فروشنده PENDING است ولی باید در فیلتر «بلوکه» دیده شود، نه اینجا.
   */
  private actionablePendingWhere(): Prisma.WalletTransactionWhereInput {
    return {
      status: WalletTransactionStatus.PENDING,
      NOT: {
        OR: [
          { type: WalletTransactionType.BLOCK },
          {
            type: WalletTransactionType.DEPOSIT,
            OR: [
              { meta: { path: ['kind'], equals: 'order-escrow' } },
              { meta: { path: ['kind'], equals: 'auction-escrow' } },
              { meta: { path: ['kind'], equals: 'gateway-escrow' } },
            ],
          },
        ],
      },
    };
  }

  private isLegacyEscrowBlockedTxn(t: {
    type: WalletTransactionType;
    status: WalletTransactionStatus;
    meta: unknown;
  }): boolean {
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
        return this.actionablePendingWhere();
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

  private sanitizeTransactionsForUser(transactions: WalletTxnRow[]) {
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
        return { ...t, amount: Number(t.amount || 0), meta: safeMeta };
      });
  }

  /**
   * هولدهای هنوز فعال قابل توجیه برای کاربر (امانت/ودیعه/برداشت در صف).
   * DEPOSIT اسکرو بعد از آزادسازی همچنان PENDING می‌ماند؛ اگر seller_released
   * برای همان order/listing ثبت شده، دیگر هولد حساب نمی‌شود (باقی‌مانده ≈ کارمزد).
   */
  private async computeActiveBlockedHolds(walletId: string): Promise<number> {
    const rows = await this.prisma.walletTransaction.findMany({
      where: {
        walletId,
        OR: [
          {
            type: WalletTransactionType.BLOCK,
            status: { not: WalletTransactionStatus.FAILED },
          },
          {
            type: WalletTransactionType.UNBLOCK,
            status: WalletTransactionStatus.SUCCESS,
          },
          {
            type: WalletTransactionType.DEPOSIT,
            status: WalletTransactionStatus.PENDING,
          },
          {
            type: WalletTransactionType.WITHDRAW_REQUEST,
            status: WalletTransactionStatus.PENDING,
          },
          {
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
          },
        ],
      },
      orderBy: { createdAt: 'asc' },
      select: {
        type: true,
        status: true,
        amount: true,
        referenceId: true,
        meta: true,
      },
    });

    const holdGroups: Array<{
      amount: number;
      orderId: string;
      listingId: string;
      ref: string;
    }> = [];
    const releasedOrderIds = new Set<string>();
    const releasedListingIdsLegacy = new Set<string>();
    let auctionBidNet = 0;
    let withdrawPending = 0;

    for (const row of rows) {
      const amount = Math.max(0, Number(row.amount) || 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const kind = String(meta['kind'] ?? '').trim();

      if (
        row.type === WalletTransactionType.WITHDRAW_REQUEST &&
        row.status === WalletTransactionStatus.PENDING
      ) {
        withdrawPending += amount;
        continue;
      }

      if (kind === 'auction-bid-deposit') {
        if (row.type === WalletTransactionType.BLOCK) auctionBidNet += amount;
        else if (
          row.type === WalletTransactionType.UNBLOCK ||
          row.type === WalletTransactionType.PENALTY
        ) {
          auctionBidNet -= amount;
        }
        continue;
      }

      if (!ESCROW_HOLD_KINDS.has(kind) && !this.isLegacyEscrowBlockedTxn(row)) {
        continue;
      }

      const orderId = String(meta['orderId'] ?? '').trim();
      const listingId = String(meta['listingId'] ?? '').trim();
      const ref = String(row.referenceId ?? '').trim();
      if (!orderId && !listingId && !ref) continue;

      if (
        row.type === WalletTransactionType.DEPOSIT &&
        row.status === WalletTransactionStatus.PENDING
      ) {
        holdGroups.push({ amount, orderId, listingId, ref });
        continue;
      }

      if (
        row.type === WalletTransactionType.UNBLOCK &&
        row.status === WalletTransactionStatus.SUCCESS
      ) {
        const phase = String(meta['phase'] ?? '').trim();
        if (phase === 'seller_released') {
          if (orderId) releasedOrderIds.add(orderId);
          // تراکنش‌های قدیمی فقط listingId دارند
          if (!orderId && listingId) releasedListingIdsLegacy.add(listingId);
          if (!orderId && !listingId && ref) releasedListingIdsLegacy.add(ref);
        } else {
          let remaining = amount;
          for (const g of holdGroups) {
            if (remaining <= 0) break;
            const overlap =
              (orderId && (g.orderId === orderId || g.ref === orderId)) ||
              (listingId &&
                (g.listingId === listingId || g.ref === listingId)) ||
              (ref &&
                (g.ref === ref ||
                  g.orderId === ref ||
                  g.listingId === ref));
            if (!overlap) continue;
            const take = Math.min(g.amount, remaining);
            g.amount -= take;
            remaining -= take;
          }
        }
        continue;
      }

      if (
        row.type === WalletTransactionType.PENALTY &&
        row.status === WalletTransactionStatus.SUCCESS
      ) {
        // کسر جزئی از هولد هم‌پوشان (نه صفر کردن کل سفارش)
        let remaining = amount;
        for (const g of holdGroups) {
          if (remaining <= 0) break;
          const overlap =
            (orderId && (g.orderId === orderId || g.ref === orderId)) ||
            (listingId &&
              (g.listingId === listingId || g.ref === listingId)) ||
            (ref &&
              (g.ref === ref || g.orderId === ref || g.listingId === ref));
          if (!overlap) continue;
          const take = Math.min(g.amount, remaining);
          g.amount -= take;
          remaining -= take;
        }
      }
    }

    let escrowActive = 0;
    for (const g of holdGroups) {
      if (g.amount <= 0) continue;
      if (g.orderId && releasedOrderIds.has(g.orderId)) continue;
      if (g.ref && releasedOrderIds.has(g.ref)) continue;
      if (!g.orderId && g.listingId && releasedListingIdsLegacy.has(g.listingId))
        continue;
      if (
        !g.orderId &&
        !g.listingId &&
        g.ref &&
        releasedListingIdsLegacy.has(g.ref)
      )
        continue;
      escrowActive += g.amount;
    }

    return Math.max(
      0,
      Math.floor(withdrawPending + Math.max(0, auctionBidNet) + escrowActive),
    );
  }

  /**
   * اگر هیچ هولد فعالی نیست ولی balanceBlocked مانده دارد، آن را پاک می‌کند
   * (بازمانده کارمزد/نشتی پس از تسویه).
   */
  private async reconcileOrphanBlockedBalance(
    userId: string,
    walletId: string,
    rawBlocked: number,
    activeHolds: number,
  ): Promise<number> {
    if (activeHolds > 0) return Math.floor(rawBlocked);
    const orphan = Math.max(0, Math.floor(rawBlocked));
    if (orphan <= 0) return 0;

    await this.prisma.$transaction(async (tx) => {
      const current = await tx.wallet.findUnique({
        where: { userId },
        select: { balanceBlocked: true },
      });
      const latestBlocked = Math.max(
        0,
        Math.floor(Number(current?.balanceBlocked ?? 0)),
      );
      // اگر در همین لحظه هولد جدیدی اضافه شده، دست نزن
      if (latestBlocked <= 0) return;

      await tx.wallet.update({
        where: { userId },
        data: { balanceBlocked: { decrement: latestBlocked } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId,
          amount: latestBlocked,
          type: WalletTransactionType.COMMISSION_FEE,
          status: WalletTransactionStatus.SUCCESS,
          meta: {
            kind: WALLET_RECONCILE_KIND,
            phase: ORPHAN_PLATFORM_FEE_CLEAR_PHASE,
            description:
              'تسویه مانده بلوکهٔ بدون هولد فعال (کارمزد/باقی‌مانده سیستمی)',
          },
        },
      });
    });

    return 0;
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

    const sanitizedMonth = this.sanitizeTransactionsForUser(monthTxs);

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
        AND: [
          this.userVisibleTransactionWhere(walletId),
          this.actionablePendingWhere(),
        ],
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

  async getWalletByUserId(userId: string) {
    let wallet = await this.support.ensureUserWallet(userId);
    const rawBlocked = Math.max(
      0,
      Math.floor(Number(wallet.balanceBlocked) || 0),
    );
    const activeHolds = await this.computeActiveBlockedHolds(wallet.id);
    const reconciledBlocked = await this.reconcileOrphanBlockedBalance(
      userId,
      wallet.id,
      rawBlocked,
      activeHolds,
    );

    if (reconciledBlocked !== rawBlocked) {
      wallet = await this.support.ensureUserWallet(userId);
    }

    const stats = await this.getWalletStatsForUser(userId, wallet.id);
    const balanceBlockedVisible = Math.min(
      Math.max(0, Math.floor(Number(wallet.balanceBlocked) || 0)),
      Math.max(0, Math.floor(activeHolds)),
    );

    return {
      ...wallet,
      // برای کاربر فقط هولدهای فعال را نشان می‌دهیم (باقی‌مانده کارمزد پنهان/پاک می‌شود).
      balanceBlocked: balanceBlockedVisible,
      balanceBlockedRaw: wallet.balanceBlocked,
      balanceBlockedVisible,
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
    const wallet = await this.support.ensureUserWallet(userId);
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

    let items = this.sanitizeTransactionsForUser(rows);

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

}
