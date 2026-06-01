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
import { WalletQueryService } from '../query/wallet-query.service';
import { WalletBlockService } from '../block/wallet-block.service';

@Injectable()
export class WalletEscrowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly support: WalletSupportService,
    private readonly query: WalletQueryService,
    private readonly block: WalletBlockService,
  ) {}

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
      const bidScoped = await this.block.getAuctionBidDepositScopedBlocked(prisma, {
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

    const auctionListingTitle = await this.support.listingTitleForWalletTx(
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
      const bidScoped = await this.block.getAuctionBidDepositScopedBlocked(prisma, {
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
    const listingTitle = await this.support.listingTitleForWalletTx(prisma, refId);
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
    const listingTitle = await this.support.listingTitleForWalletTx(prisma, refId);
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

    const wallet = await this.query.getWalletByUserId(sellerId);
    const listingTitle = await this.support.listingTitleForWalletTx(prisma, listingId);
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

  escrowDepositBelongsToOrder(
    meta: Record<string, unknown>,
    params: { orderId: string; listingId: string },
  ): boolean {
    const metaOrderId = String(meta['orderId'] ?? '').trim();
    const metaListingId = String(meta['listingId'] ?? '').trim();
    if (metaOrderId) return metaOrderId === params.orderId;
    if (metaListingId) return metaListingId === params.listingId;
    return true;
  }

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
