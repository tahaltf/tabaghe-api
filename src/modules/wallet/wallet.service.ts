import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  WalletTransactionType,
  WalletTransactionStatus,
  Prisma,
  NotificationType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { NotificationService } from '../notification/notification.service';

/**
 * Marker stored inside `WalletTransaction.meta.kind` to distinguish user-initiated
 * top-up requests (DEPOSIT + PENDING, awaiting admin approval) from escrow
 * deposits credited to sellers when a buyer pays.
 */
const MANUAL_DEPOSIT_KIND = 'manual-deposit';
const GATEWAY_TOPUP_KIND = 'gateway-topup';

@Injectable()
export class WalletService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationService: NotificationService,
  ) {}

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

  async getWalletByUserId(userId: string) {
    let wallet = await this.prisma.wallet.findUnique({ where: { userId } });

    if (!wallet) {
      wallet = await this.prisma.wallet.create({
        data: { userId, balanceAvailable: 0, balanceBlocked: 0 },
      });
    }

    const transactions = await this.prisma.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        NOT: {
          AND: [
            { type: WalletTransactionType.DEPOSIT },
            { meta: { path: ['kind'], equals: GATEWAY_TOPUP_KIND } },
            { status: { not: WalletTransactionStatus.SUCCESS } },
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
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
      .map((t) => ((t.meta as Record<string, unknown>)['listingId'] as string));

    const uniqueSellerBlockedListingIds = Array.from(new Set(sellerBlockedListingIds));
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

    // meta شامل فیلدهای داخلی (مثل adminNote، ipAddress، receipt، ...)
    // است. برای کاربر فقط کلیدهای عمومی/مفید رو نگه میداریم.
    const ALLOWED_META_KEYS = new Set([
      'kind',
      'phase',
      'description',
      'orderId',
      'listingId',
      'listingTitle',
      'auctionId',
      'refundReason',
      'receiptImageUrl',
      'rejectionReason',
      'adminNote',
      'repairTrackingCode',
      'paymentSource',
      'settlementKind',
      'agreementAmount',
    ]);

    const safeTxns = transactions
      .filter((t) => {
        const meta = t.meta as Record<string, unknown> | null;
        // لاگ‌های بی‌معنای «درآمد ۰» را به کاربر نشان نده.
        return !(
          t.type === WalletTransactionType.DEPOSIT &&
          Number(t.amount || 0) <= 0 &&
          !!meta &&
          meta['kind'] === 'order-escrow' &&
          meta['phase'] === 'seller_blocked'
        );
      })
      .map((t) => {
      let safeMeta: Record<string, unknown> | null = null;
      if (t.meta && typeof t.meta === 'object' && !Array.isArray(t.meta)) {
        safeMeta = {};
        for (const [k, v] of Object.entries(t.meta as Record<string, unknown>)) {
          if (ALLOWED_META_KEYS.has(k)) safeMeta[k] = v;
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
        // سفارش‌های قدیمی معاوضه که platformFee اشتباه خورده‌اند:
        // مقدار بلوکه را در نمایش به مقدار صحیح (sellerRevenue + platformFee) نرمال می‌کنیم.
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

    return { ...wallet, transactions: safeTxns };
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
        meta: { description: 'مسدودسازی ودیعه شرکت در مزایده' },
      },
    });
  }

  async unblockAmount(
    userId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
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

  async confiscateBlocked(
    userId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
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
        meta: { description: 'جریمه عدم پرداخت مزایده (ضبط ودیعه)' },
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
      await prisma.wallet.update({
        where: { userId: buyerId },
        data: { balanceBlocked: { decrement: depositDec.toString() } },
      });
    }

    const auctionListingTitle = await this.listingTitleForWalletTx(prisma, refId);

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
            ...(auctionListingTitle ? { listingTitle: auctionListingTitle } : {}),
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
          ...(auctionListingTitle ? { listingTitle: auctionListingTitle } : {}),
          description: auctionListingTitle
            ? `درآمد فروش مزایده بلوکه است تا خریدار دریافت کالا را تأیید کند — «${auctionListingTitle}». پس از تأیید، به موجودی قابل برداشت منتقل می‌شود.`
            : 'درآمد فروش مزایده بلوکه است تا خریدار دریافت را تأیید کند؛ سپس آزاد می‌شود.',
        },
      },
    });
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
    opts?: { isExchangeEscrow?: boolean; blockedAmount?: number | string | Decimal },
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const feeDec = new Decimal(platformFee);
    const blockedAmountDec =
      opts?.blockedAmount !== undefined ? new Decimal(opts.blockedAmount) : amountDec.minus(feeDec);
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
      throw new BadRequestException('مبلغ بلوکه فروشنده نمی‌تواند بیشتر از مبلغ پرداختی باشد');
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
    opts?: { isExchangeEscrow?: boolean; blockedAmount?: number | string | Decimal },
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
    const feeDec = new Decimal(platformFee);
    const blockedAmountDec =
      opts?.blockedAmount !== undefined ? new Decimal(opts.blockedAmount) : amountDec.minus(feeDec);
    const sellerRevenue = blockedAmountDec;

    if (amountDec.lte(0)) {
      throw new BadRequestException('مبلغ پرداخت نامعتبر است');
    }
    if (blockedAmountDec.lt(0)) {
      throw new BadRequestException('مبلغ بلوکه فروشنده نامعتبر است');
    }
    if (blockedAmountDec.gt(amountDec)) {
      throw new BadRequestException('مبلغ بلوکه فروشنده نمی‌تواند بیشتر از مبلغ پرداختی باشد');
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

  async releaseEscrow(
    sellerId: string,
    amount: number | string | Decimal,
    listingId: string,
    tx?: Prisma.TransactionClient,
    opts?: { orderId?: string },
  ) {
    const prisma = tx || this.prisma;
    const amountDec = new Decimal(amount);
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
      await tx.wallet.upsert({
        where: { userId: sellerId },
        create: { userId: sellerId, balanceAvailable: 0, balanceBlocked: 0 },
        update: { balanceBlocked: { decrement: br } },
      });
      const sellerWallet = await tx.wallet.findUnique({
        where: { userId: sellerId },
        select: { id: true },
      });
      if (sellerWallet) {
        await tx.walletTransaction.create({
          data: {
            walletId: sellerWallet.id,
            amount: br,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: orderId,
            meta: {
              kind: 'exchange-return-refund',
              orderId,
              listingId,
              description:
                'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت به پرداخت‌کننده',
            } as Prisma.InputJsonValue,
          },
        });
      }
      await tx.wallet.upsert({
        where: { userId: buyerId },
        create: { userId: buyerId, balanceAvailable: br, balanceBlocked: 0 },
        update: { balanceAvailable: { increment: br } },
      });
      const buyerWallet = await tx.wallet.findUnique({
        where: { userId: buyerId },
        select: { id: true },
      });
      if (buyerWallet) {
        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            amount: br,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: orderId,
            meta: {
              kind: 'exchange-return-refund',
              orderId,
              listingId,
              description: 'بازگشت مابه‌التفاوت معاوضه به پرداخت‌کننده (بدون هزینه کارشناسی)',
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    if (!isPayerMe && sr > 0) {
      await tx.wallet.upsert({
        where: { userId: buyerId },
        create: { userId: buyerId, balanceAvailable: 0, balanceBlocked: 0 },
        update: { balanceBlocked: { decrement: sr } },
      });
      const buyerWallet = await tx.wallet.findUnique({
        where: { userId: buyerId },
        select: { id: true },
      });
      if (buyerWallet) {
        await tx.walletTransaction.create({
          data: {
            walletId: buyerWallet.id,
            amount: sr,
            type: WalletTransactionType.PENALTY,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: orderId,
            meta: {
              kind: 'exchange-return-refund',
              orderId,
              listingId,
              description:
                'لغو معاوضه: برداشت از بلوکه طرف مقابل برای بازگشت مابه‌التفاوت به پرداخت‌کننده',
            } as Prisma.InputJsonValue,
          },
        });
      }
      await tx.wallet.upsert({
        where: { userId: sellerId },
        create: { userId: sellerId, balanceAvailable: sr, balanceBlocked: 0 },
        update: { balanceAvailable: { increment: sr } },
      });
      const sellerWallet = await tx.wallet.findUnique({
        where: { userId: sellerId },
        select: { id: true },
      });
      if (sellerWallet) {
        await tx.walletTransaction.create({
          data: {
            walletId: sellerWallet.id,
            amount: sr,
            type: WalletTransactionType.REFUND,
            status: WalletTransactionStatus.SUCCESS,
            referenceId: orderId,
            meta: {
              kind: 'exchange-return-refund',
              orderId,
              listingId,
              description: 'بازگشت مابه‌التفاوت معاوضه به پرداخت‌کننده (بدون هزینه کارشناسی)',
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
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
      type: NotificationType.SYSTEM,
      title: 'درخواست شارژ دستی ثبت شد',
      message:
        'درخواست شما ثبت شد و پس از بررسی ادمین، نتیجه از همین بخش اطلاع‌رسانی می‌شود.',
      meta: {
        transactionId: created.id,
        amount: amountDec.toNumber(),
        kind: MANUAL_DEPOSIT_KIND,
      },
    });

    return created;
  }

  async getDepositRequestsAdmin(params: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}) {
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
            type: NotificationType.SYSTEM,
            title: 'شارژ کیف پول تایید شد',
            message:
              'درخواست شارژ دستی شما تایید شد و مبلغ به موجودی قابل برداشت اضافه شد.',
            meta: {
              transactionId,
              amount: amountDec.toNumber(),
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
          type: NotificationType.SYSTEM,
          title: 'درخواست شارژ دستی رد شد',
          message: adminNote
            ? `درخواست شارژ شما رد شد. دلیل: ${adminNote}`
            : 'درخواست شارژ شما توسط ادمین رد شد.',
          meta: {
            transactionId,
            amount: amountDec.toNumber(),
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

  async getWithdrawRequestsAdmin(params: {
    status?: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL';
    page?: number;
    pageSize?: number;
    search?: string;
  } = {}) {
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
    return this.prisma.$transaction(async (tx) => {
      const transaction = await tx.walletTransaction.findUnique({
        where: { id: transactionId },
      });

      if (
        !transaction ||
        transaction.status !== WalletTransactionStatus.PENDING
      ) {
        throw new BadRequestException('تراکنش نامعتبر است یا قبلا پردازش شده');
      }

      const amountDec = new Decimal(transaction.amount); // جلوگیری از خطای اعشار در آپدیت‌های پریسما

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

        return { message: 'درخواست برداشت تایید و مبلغ کسر شد' };
      } else {
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
              rejectionReason: 'رد توسط ادمین',
            },
          },
        });

        return { message: 'درخواست رد شد و مبلغ به کیف پول بازگشت' };
      }
    });
  }
  async payFromAvailable(userId: string, amount: number | string | Decimal, referenceId: string, tx?: Prisma.TransactionClient) {
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
