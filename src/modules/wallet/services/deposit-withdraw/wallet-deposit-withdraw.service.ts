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
import { NotificationService } from '../../../notification/notification.service';
import { MANUAL_DEPOSIT_KIND } from '../../wallet.constants';
import { WalletQueryService } from '../query/wallet-query.service';

@Injectable()
export class WalletDepositWithdrawService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
    private readonly query: WalletQueryService,
  ) {}

  async deposit(userId: string, amount: number | string | Decimal) {
    const wallet = await this.query.getWalletByUserId(userId);
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

    const wallet = await this.query.getWalletByUserId(userId);

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
    const wallet = await this.query.getWalletByUserId(userId);

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
}
