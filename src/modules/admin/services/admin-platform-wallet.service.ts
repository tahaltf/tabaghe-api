import { BadRequestException, Injectable } from '@nestjs/common';
import {
  OrderStatus,
  RepairRequestStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PlatformCreditSource } from '../dto/admin-platform-wallet.dto';

const PROFIT_WITHDRAWN_KEY = 'PLATFORM_PROFIT_WITHDRAWN';
const PROFIT_USER_CREDITS_KEY = 'PLATFORM_PROFIT_USER_CREDITS';
const PROFIT_LEDGER_KEY = 'PLATFORM_PROFIT_LEDGER';
const REALIZED_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.COMPLETED,
  OrderStatus.DELIVERED,
];
const INTERNAL_PROFIT_MARK = '[INTERNAL_PROFIT]';
type PlatformHistoryRange = 'today' | '7d' | '30d' | '90d' | '365d' | 'all';
type PlatformHistorySide = 'IN' | 'OUT' | 'ALL';

interface PlatformLedgerEntry {
  type:
    | 'WITHDRAW_PROFIT'
    | 'CREDIT_USER_FROM_PROFIT'
    | 'CREDIT_USER_FROM_EXTERNAL';
  amount: number;
  note?: string | null;
  userId?: string | null;
  createdAt: string;
}

@Injectable()
export class AdminPlatformWalletService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary() {
    const [
      walletAgg,
      commissionAgg,
      verificationAgg,
      penaltiesAgg,
      repairs,
      withdrawn,
      userCredits,
    ] = await Promise.all([
      this.prisma.wallet.aggregate({
        _sum: { balanceAvailable: true, balanceBlocked: true },
      }),
      this.prisma.order.aggregate({
        where: { status: { in: REALIZED_ORDER_STATUSES } },
        _sum: { platformFee: true },
      }),
      this.prisma.order.aggregate({
        where: {
          status: { in: REALIZED_ORDER_STATUSES },
          requiresVerification: true,
        },
        _sum: { verificationFee: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: {
          type: WalletTransactionType.PENALTY,
          status: WalletTransactionStatus.SUCCESS,
        },
        _sum: { amount: true },
      }),
      this.prisma.repairRequest.findMany({
        where: { status: RepairRequestStatus.COMPLETED },
        select: { adminNote: true },
      }),
      this.getNumericSetting(PROFIT_WITHDRAWN_KEY),
      this.getNumericSetting(PROFIT_USER_CREDITS_KEY),
    ]);

    const repairProfit = repairs.reduce(
      (acc, r) => acc.plus(this.extractInternalProfit(r.adminNote)),
      new Decimal(0),
    );
    const commission = new Decimal(commissionAgg._sum.platformFee ?? 0);
    const verification = new Decimal(verificationAgg._sum.verificationFee ?? 0);
    const penalties = new Decimal(penaltiesAgg._sum.amount ?? 0);
    const accrued = commission
      .plus(verification)
      .plus(penalties)
      .plus(repairProfit);
    const deductions = withdrawn.plus(userCredits);
    const profitBalance = Decimal.max(accrued.minus(deductions), 0);

    const available = new Decimal(walletAgg._sum.balanceAvailable ?? 0);
    const blocked = new Decimal(walletAgg._sum.balanceBlocked ?? 0);
    const total = available.plus(blocked);

    return {
      systemWallet: {
        total: total.toNumber(),
        available: available.toNumber(),
        blocked: blocked.toNumber(),
      },
      profitWallet: {
        balance: profitBalance.toNumber(),
        accrued: {
          commission: commission.toNumber(),
          verificationFees: verification.toNumber(),
          repairProfit: repairProfit.toNumber(),
          penalties: penalties.toNumber(),
          total: accrued.toNumber(),
        },
        deductions: {
          withdrawn: withdrawn.toNumber(),
          userCreditsFromProfit: userCredits.toNumber(),
          total: deductions.toNumber(),
        },
      },
    };
  }

  async withdrawProfit(amount: number, note?: string) {
    const summary = await this.getSummary();
    const balance = new Decimal(summary.profitWallet.balance);
    const amountDec = new Decimal(amount);
    if (amountDec.lte(0))
      throw new BadRequestException('مبلغ برداشت نامعتبر است');
    if (balance.lt(amountDec))
      throw new BadRequestException('موجودی سود طبقه کافی نیست');

    await this.incrementSetting(PROFIT_WITHDRAWN_KEY, amountDec);
    await this.appendLedger({
      type: 'WITHDRAW_PROFIT',
      amount: amountDec.toNumber(),
      note: note?.trim() || null,
      createdAt: new Date().toISOString(),
    });
    await this.prisma.systemSetting.upsert({
      where: { key: 'PLATFORM_PROFIT_LAST_WITHDRAW_NOTE' },
      update: { value: note?.trim() || '' },
      create: {
        key: 'PLATFORM_PROFIT_LAST_WITHDRAW_NOTE',
        value: note?.trim() || '',
      },
    });

    return this.getSummary();
  }

  async creditUser(
    userId: string,
    amount: number,
    source: PlatformCreditSource,
    note?: string,
  ) {
    const amountDec = new Decimal(amount);
    if (amountDec.lte(0))
      throw new BadRequestException('مبلغ شارژ نامعتبر است');

    if (source === PlatformCreditSource.PROFIT) {
      const summary = await this.getSummary();
      if (new Decimal(summary.profitWallet.balance).lt(amountDec)) {
        throw new BadRequestException('موجودی سود طبقه کافی نیست');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { userId },
        create: {
          userId,
          balanceAvailable: amountDec.toNumber(),
          balanceBlocked: 0,
        },
        update: { balanceAvailable: { increment: amountDec.toString() } },
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          amount: amountDec.toNumber(),
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.SUCCESS,
          meta: {
            kind: 'admin-manual-credit',
            source,
            note: note?.trim() || null,
            description:
              source === PlatformCreditSource.PROFIT
                ? 'شارژ دستی از سود طبقه'
                : 'شارژ دستی بر اساس واریزی خارجی',
          },
        },
      });

      if (source === PlatformCreditSource.PROFIT) {
        await this.incrementSetting(PROFIT_USER_CREDITS_KEY, amountDec, tx);
      }
    });
    await this.appendLedger({
      type:
        source === PlatformCreditSource.PROFIT
          ? 'CREDIT_USER_FROM_PROFIT'
          : 'CREDIT_USER_FROM_EXTERNAL',
      amount: amountDec.toNumber(),
      userId,
      note: note?.trim() || null,
      createdAt: new Date().toISOString(),
    });

    return this.getSummary();
  }

  async getHistory(
    params: {
      range?: PlatformHistoryRange;
      page?: number;
      pageSize?: number;
      search?: string;
      side?: PlatformHistorySide;
      source?: string;
    } = {},
  ) {
    const range = params.range ?? '30d';
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, params.pageSize ?? 20));
    const search = (params.search ?? '').trim().toLowerCase();
    const sideFilter = params.side ?? 'ALL';
    const sourceFilter = (params.source ?? '').trim().toLowerCase();
    const since = this.getRangeSince(range);
    const [orders, penalties, repairs, ledger] = await Promise.all([
      this.prisma.order.findMany({
        where: {
          status: { in: REALIZED_ORDER_STATUSES },
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        select: {
          id: true,
          type: true,
          platformFee: true,
          verificationFee: true,
          createdAt: true,
        },
      }),
      this.prisma.walletTransaction.findMany({
        where: {
          type: WalletTransactionType.PENALTY,
          status: WalletTransactionStatus.SUCCESS,
          ...(since ? { createdAt: { gte: since } } : {}),
        },
        select: { id: true, amount: true, createdAt: true, referenceId: true },
      }),
      this.prisma.repairRequest.findMany({
        where: {
          status: RepairRequestStatus.COMPLETED,
          ...(since ? { updatedAt: { gte: since } } : {}),
        },
        select: { id: true, updatedAt: true, adminNote: true },
      }),
      this.readLedgerEntries(since),
    ]);

    const rows: Array<{
      id: string;
      side: 'IN' | 'OUT';
      source: string;
      amount: number;
      createdAt: string;
      referenceId?: string | null;
      note?: string | null;
    }> = [];

    for (const o of orders) {
      const commission = new Decimal(o.platformFee ?? 0);
      if (commission.gt(0)) {
        rows.push({
          id: `order-fee-${o.id}`,
          side: 'IN',
          source: 'کارمزد معامله',
          amount: commission.toNumber(),
          createdAt: o.createdAt.toISOString(),
          referenceId: o.id,
        });
      }
      const verification = new Decimal(o.verificationFee ?? 0);
      if (verification.gt(0)) {
        rows.push({
          id: `order-verification-${o.id}`,
          side: 'IN',
          source: 'هزینه کارشناسی',
          amount: verification.toNumber(),
          createdAt: o.createdAt.toISOString(),
          referenceId: o.id,
        });
      }
    }

    for (const p of penalties) {
      const amount = new Decimal(p.amount ?? 0);
      if (amount.gt(0)) {
        rows.push({
          id: `penalty-${p.id}`,
          side: 'IN',
          source: 'جریمه پلتفرم',
          amount: amount.toNumber(),
          createdAt: p.createdAt.toISOString(),
          referenceId: p.referenceId ?? null,
        });
      }
    }

    for (const r of repairs) {
      const amount = this.extractInternalProfit(r.adminNote);
      if (amount.gt(0)) {
        rows.push({
          id: `repair-profit-${r.id}`,
          side: 'IN',
          source: 'سود تعمیرات',
          amount: amount.toNumber(),
          createdAt: r.updatedAt.toISOString(),
          referenceId: r.id,
        });
      }
    }

    for (const e of ledger) {
      rows.push({
        id: `ledger-${e.createdAt}-${e.type}-${Math.random().toString(36).slice(2, 8)}`,
        side: 'OUT',
        source:
          e.type === 'WITHDRAW_PROFIT'
            ? 'برداشت سود'
            : e.type === 'CREDIT_USER_FROM_PROFIT'
              ? 'شارژ کاربر از سود'
              : 'شارژ کاربر از منبع بیرونی',
        amount: e.amount,
        createdAt: e.createdAt,
        referenceId: e.userId ?? null,
        note: e.note ?? null,
      });
    }

    const filtered = rows.filter((r) => {
      if (sideFilter !== 'ALL' && r.side !== sideFilter) return false;
      if (sourceFilter && !r.source.toLowerCase().includes(sourceFilter))
        return false;
      if (search) {
        const hay =
          `${r.source} ${r.referenceId ?? ''} ${r.note ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    filtered.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
    const inTotal = filtered
      .filter((r) => r.side === 'IN')
      .reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    const outTotal = filtered
      .filter((r) => r.side === 'OUT')
      .reduce((acc, r) => acc.plus(r.amount), new Decimal(0));
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return {
      range,
      since: since?.toISOString() ?? null,
      filters: {
        side: sideFilter,
        source: params.source ?? '',
        search: params.search ?? '',
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
      totals: {
        in: inTotal.toNumber(),
        out: outTotal.toNumber(),
        net: inTotal.minus(outTotal).toNumber(),
      },
      items,
    };
  }

  private extractInternalProfit(adminNote: string | null | undefined): Decimal {
    const line = (adminNote ?? '')
      .split('\n')
      .find((x) => x.trim().startsWith(INTERNAL_PROFIT_MARK));
    if (!line) return new Decimal(0);
    const value = line.trim().slice(INTERNAL_PROFIT_MARK.length).trim();
    const parsed = new Decimal(value || 0);
    return parsed.isFinite() ? Decimal.max(parsed, 0) : new Decimal(0);
  }

  private async getNumericSetting(key: string): Promise<Decimal> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const num = new Decimal(row?.value ?? 0);
    return num.isFinite() ? Decimal.max(num, 0) : new Decimal(0);
  }

  private async incrementSetting(
    key: string,
    amount: Decimal,
    tx?: PrismaService | any,
  ) {
    const prisma = tx ?? this.prisma;
    const current = await prisma.systemSetting.findUnique({
      where: { key },
      select: { value: true },
    });
    const next = new Decimal(current?.value ?? 0).plus(amount);
    await prisma.systemSetting.upsert({
      where: { key },
      update: { value: next.toFixed(0) },
      create: { key, value: next.toFixed(0) },
    });
  }

  private getRangeSince(range: PlatformHistoryRange): Date | null {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    if (range === 'all') return null;
    if (range === 'today') {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return d;
    }
    const map: Record<
      Exclude<PlatformHistoryRange, 'all' | 'today'>,
      number
    > = {
      '7d': 7,
      '30d': 30,
      '90d': 90,
      '365d': 365,
    };
    return new Date(now - map[range as keyof typeof map] * day);
  }

  private async appendLedger(entry: PlatformLedgerEntry): Promise<void> {
    const current = await this.prisma.systemSetting.findUnique({
      where: { key: PROFIT_LEDGER_KEY },
      select: { value: true },
    });
    let rows: PlatformLedgerEntry[] = [];
    try {
      rows = current?.value ? JSON.parse(current.value) : [];
      if (!Array.isArray(rows)) rows = [];
    } catch {
      rows = [];
    }
    rows.push(entry);
    if (rows.length > 2000) rows = rows.slice(rows.length - 2000);
    await this.prisma.systemSetting.upsert({
      where: { key: PROFIT_LEDGER_KEY },
      update: { value: JSON.stringify(rows) },
      create: { key: PROFIT_LEDGER_KEY, value: JSON.stringify(rows) },
    });
  }

  private async readLedgerEntries(
    since: Date | null,
  ): Promise<PlatformLedgerEntry[]> {
    const current = await this.prisma.systemSetting.findUnique({
      where: { key: PROFIT_LEDGER_KEY },
      select: { value: true },
    });
    try {
      const rows = current?.value
        ? (JSON.parse(current.value) as PlatformLedgerEntry[])
        : [];
      if (!Array.isArray(rows)) return [];
      return rows.filter((r) => !since || new Date(r.createdAt) >= since);
    } catch {
      return [];
    }
  }
}
