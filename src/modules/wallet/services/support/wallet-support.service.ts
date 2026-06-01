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

@Injectable()
export class WalletSupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

  async notifyWalletRefund(params: {
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
  settlementBelongsToExchangeOrder(
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
  async listingTitleForWalletTx(
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

  async ensureUserWallet(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }
    return wallet;
  }
}
