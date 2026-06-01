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
  } from '@prisma/client';
import Decimal from 'decimal.js';
import {
  buildPaginationMeta,
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
} from '../../../../shared/contracts/pagination';
import { ALLOWED_WALLET_META_KEYS, GATEWAY_TOPUP_KIND, UserWalletTxFilter, WalletTxnRow } from '../../wallet.constants';
import { WalletSupportService } from '../support/wallet-support.service';


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

  async getWalletByUserId(userId: string) {
    const wallet = await this.support.ensureUserWallet(userId);
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

}
