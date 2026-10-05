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
  ListingStatus,
  OrderStatus,
  CheckoutSessionStatus,
  OrderType,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { decrementSoldStock } from '../../../../common/listing/listing-variation.util';
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
   * حداکثر مبلغی که برای یک سفارش می‌توان از بلوکه آزاد یا کسر کرد
   * (DEPOSIT PENDING همان سفارش منهای UNBLOCK/PENALTY همان سفارش).
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
    opts?: { orderId?: string; reason?: string },
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
    if (amountDec.lte(0)) return 0;

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
          ...(opts?.reason ? { releaseReason: opts.reason } : {}),
          description: this.releaseEscrowDescription(titleQuoted, opts?.reason),
        },
      },
    });
    return amountDec.toNumber();
  }

  private releaseEscrowDescription(titleQuoted: string, reason?: string): string {
    switch (reason) {
      case 'TRUSTED_SHIPMENT':
        return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون فروشنده مورد اعتماد پس از ارسال به خریدار تسویه زودهنگام دارد.`;
      case 'HUB_VERIFIED':
        return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون کارشناسی هاب تایید شد.`;
      case 'ADMIN':
        return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد با دستور ادمین.`;
      case 'AUTO_CONFIRM':
        return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون مهلت تایید خریدار به پایان رسید.`;
      default:
        return `آزادسازی درآمد فروش برای ${titleQuoted}: مبلغ از «بلوکه‌شده» به موجودی قابل برداشت منتقل شد چون خریدار دریافت کالا را تأیید کرد.`;
    }
  }

  /**
   * کسر سهم فروشنده برای ریفاند: اول بلوکهٔ همان سفارش، بعد موجودی قابل برداشت.
   * اگر موجودی کافی نباشد خطا می‌دهد تا موجودی سفارش‌های دیگر دست نخورد.
   */
  async clawbackSellerPayout(
    tx: Prisma.TransactionClient,
    params: {
      userId: string;
      orderId: string;
      listingId: string;
      requestedAmount: number | string | Decimal;
      penaltyMeta: Prisma.InputJsonValue;
      referenceId?: string;
    },
  ): Promise<{ fromBlocked: number; fromAvailable: number }> {
    const requested = Math.max(
      0,
      Number(new Decimal(params.requestedAmount)) || 0,
    );
    if (requested <= 0) return { fromBlocked: 0, fromAvailable: 0 };

    const fromBlocked = await this.debitOrderScopedBlocked(tx, {
      userId: params.userId,
      orderId: params.orderId,
      listingId: params.listingId,
      requestedAmount: requested,
      penaltyMeta: params.penaltyMeta,
      referenceId: params.referenceId,
    });
    const remain = Math.max(0, requested - fromBlocked);
    if (remain <= 0) return { fromBlocked, fromAvailable: 0 };

    const wallet = await tx.wallet.upsert({
      where: { userId: params.userId },
      create: {
        userId: params.userId,
        balanceAvailable: 0,
        balanceBlocked: 0,
      },
      update: {},
      select: { id: true, balanceAvailable: true },
    });
    const available = Math.max(0, Number(wallet.balanceAvailable) || 0);
    if (available < remain) {
      const shortfall = remain - available;
      throw new BadRequestException(
        `موجودی قابل برداشت فروشنده برای بازگشت وجه کافی نیست (کسری ${shortfall.toLocaleString('fa-IR')} تومان). اگر مبلغ قبلاً برداشت شده، رسیدگی دستی لازم است.`,
      );
    }

    await tx.wallet.update({
      where: { userId: params.userId },
      data: { balanceAvailable: { decrement: remain } },
    });

    const baseMeta =
      params.penaltyMeta &&
      typeof params.penaltyMeta === 'object' &&
      !Array.isArray(params.penaltyMeta)
        ? { ...(params.penaltyMeta as Record<string, unknown>) }
        : {};
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount: remain,
        type: WalletTransactionType.PENALTY,
        status: WalletTransactionStatus.SUCCESS,
        referenceId: params.referenceId ?? params.orderId,
        meta: {
          ...baseMeta,
          kind: String(baseMeta['kind'] ?? 'order-escrow'),
          phase: 'seller_available_debit',
          orderId: params.orderId,
          listingId: params.listingId,
          clawbackFrom: 'available',
        } as Prisma.InputJsonValue,
      },
    });
    return { fromBlocked, fromAvailable: remain };
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
   * DEPOSITهای PENDING منهای UNBLOCK/PENALTY همان سفارش تا آزادسازی دوباره
   * یا کسر از بلوکهٔ سفارش دیگر رخ ندهد.
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
      select: { amount: true, meta: true, referenceId: true, type: true },
    });

    const releasedOrDebited = await tx.walletTransaction.findMany({
      where: {
        walletId: wallet.id,
        status: WalletTransactionStatus.SUCCESS,
        type: {
          in: [WalletTransactionType.UNBLOCK, WalletTransactionType.PENALTY],
        },
        OR: [
          { referenceId: params.orderId },
          { referenceId: params.listingId },
        ],
      },
      select: { amount: true, meta: true, type: true },
    });

    const orderEscrowPhases = new Set([
      'seller_blocked',
      'buyer_settlement_blocked',
      'seller_settlement_blocked',
      'shipping_blocked',
    ]);
    const auctionEscrowPhases = new Set(['seller_blocked', 'shipping_blocked']);
    const debitPhases = new Set([
      'seller_blocked_debit',
      'seller_settlement_debit',
      'seller_available_debit',
    ]);

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

    for (const row of releasedOrDebited) {
      const meta = (row.meta ?? {}) as Record<string, unknown>;
      const phase = String(meta['phase'] ?? '').trim();
      if (!this.escrowDepositBelongsToOrder(meta, params)) continue;
      if (row.type === WalletTransactionType.UNBLOCK) {
        if (phase !== 'seller_released') continue;
      } else if (row.type === WalletTransactionType.PENALTY) {
        if (!debitPhases.has(phase)) continue;
      } else {
        continue;
      }
      scopedBlocked -= Math.max(0, Number(row.amount) || 0);
    }
    return Math.max(0, scopedBlocked);
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

  /**
   * آیا لاگ امانت خرید برای این سفارش ثبت شده؟
   * (فروشنده: DEPOSIT PENDING seller_blocked — خریدار: SETTLEMENT buyer_paid)
   */
  async getPurchaseEscrowPresence(
    orderId: string,
    opts?: {
      buyerId?: string;
      sellerId?: string;
      listingId?: string;
      tx?: Prisma.TransactionClient;
    },
  ): Promise<{ sellerBlocked: boolean; buyerPaid: boolean }> {
    const prisma = opts?.tx || this.prisma;
    const order =
      opts?.buyerId && opts?.sellerId && opts?.listingId
        ? {
            id: orderId,
            buyerId: opts.buyerId,
            sellerId: opts.sellerId,
            listingId: opts.listingId,
          }
        : await prisma.order.findUnique({
            where: { id: orderId },
            select: {
              id: true,
              buyerId: true,
              sellerId: true,
              listingId: true,
            },
          });
    if (!order) {
      return { sellerBlocked: false, buyerPaid: false };
    }

    const [sellerWallet, buyerWallet] = await Promise.all([
      prisma.wallet.findUnique({
        where: { userId: order.sellerId },
        select: { id: true },
      }),
      prisma.wallet.findUnique({
        where: { userId: order.buyerId },
        select: { id: true },
      }),
    ]);

    let sellerBlocked = false;
    let buyerPaid = false;

    if (sellerWallet) {
      const rows = await prisma.walletTransaction.findMany({
        where: {
          walletId: sellerWallet.id,
          type: WalletTransactionType.DEPOSIT,
          status: WalletTransactionStatus.PENDING,
          OR: [
            { referenceId: order.id },
            { referenceId: order.listingId },
          ],
        },
        select: { meta: true },
      });
      sellerBlocked = rows.some((row) => {
        const meta = (row.meta ?? {}) as Record<string, unknown>;
        if (String(meta['kind'] ?? '') !== 'order-escrow') return false;
        if (String(meta['phase'] ?? '') !== 'seller_blocked') return false;
        const metaOrderId = String(meta['orderId'] ?? '').trim();
        if (metaOrderId) return metaOrderId === order.id;
        return String(meta['listingId'] ?? order.listingId) === order.listingId;
      });
    }

    if (buyerWallet) {
      const rows = await prisma.walletTransaction.findMany({
        where: {
          walletId: buyerWallet.id,
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          OR: [
            { referenceId: order.id },
            { referenceId: order.listingId },
          ],
        },
        select: { meta: true },
      });
      buyerPaid = rows.some((row) => {
        const meta = (row.meta ?? {}) as Record<string, unknown>;
        if (String(meta['kind'] ?? '') !== 'order-escrow') return false;
        const phase = String(meta['phase'] ?? '');
        if (phase !== 'buyer_paid' && phase !== 'exchange_participant_paid') {
          return false;
        }
        const metaOrderId = String(meta['orderId'] ?? '').trim();
        if (metaOrderId) return metaOrderId === order.id;
        return String(meta['listingId'] ?? order.listingId) === order.listingId;
      });
    }

    return { sellerBlocked, buyerPaid };
  }

  /**
   * ثبت امانت خرید از درگاه به‌صورت idempotent (بدون دوباره‌کاری اگر لاگ از قبل هست).
   * برای callback سبد/تکی و تعمیر سفارش‌های خراب.
   */
  async ensureGatewayPurchaseEscrowInTx(
    tx: Prisma.TransactionClient,
    params: {
      orderId: string;
      buyerId: string;
      sellerId: string;
      listingId: string;
      paidAmount: number;
      platformCut: number;
      paymentSource?: 'GATEWAY' | 'WALLET' | 'REPAIR';
      listingTitle?: string | null;
    },
  ): Promise<{ createdSellerBlocked: boolean; createdBuyerPaid: boolean }> {
    const paidAmount = Math.max(0, Number(params.paidAmount) || 0);
    const platformCut = Math.max(0, Number(params.platformCut) || 0);
    const sellerRevenue = Math.max(0, paidAmount - platformCut);
    const paymentSource = params.paymentSource ?? 'GATEWAY';

    const presence = await this.getPurchaseEscrowPresence(params.orderId, {
      buyerId: params.buyerId,
      sellerId: params.sellerId,
      listingId: params.listingId,
      tx,
    });

    let createdSellerBlocked = false;
    let createdBuyerPaid = false;

    if (!presence.sellerBlocked && sellerRevenue > 0) {
      await this.creditExternalPaymentToEscrow(
        params.sellerId,
        paidAmount,
        platformCut,
        params.listingId,
        tx,
        { orderId: params.orderId },
      );
      createdSellerBlocked = true;
    }

    if (!presence.buyerPaid && paidAmount > 0) {
      const listingTitle =
        params.listingTitle ??
        (await this.support.listingTitleForWalletTx(tx, params.listingId));
      const payerWallet = await tx.wallet.upsert({
        where: { userId: params.buyerId },
        create: {
          userId: params.buyerId,
          balanceAvailable: 0,
          balanceBlocked: 0,
        },
        update: {},
      });
      await tx.walletTransaction.create({
        data: {
          walletId: payerWallet.id,
          amount: paidAmount,
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          referenceId: params.listingId,
          meta: {
            kind: 'order-escrow',
            phase: 'buyer_paid',
            orderId: params.orderId,
            listingId: params.listingId,
            ...(listingTitle ? { listingTitle } : {}),
            paymentSource,
            ...(paymentSource === 'REPAIR'
              ? { repaired: true, repairReason: 'missing-purchase-escrow' }
              : {}),
            description: listingTitle
              ? `پرداخت خرید برای «${listingTitle}» از درگاه ثبت شد.`
              : 'پرداخت خرید از درگاه ثبت شد.',
          },
        },
      });
      createdBuyerPaid = true;
    }

    await this.linkEscrowDepositsToOrder(tx, {
      orderId: params.orderId,
      listingId: params.listingId,
      userIds: [params.buyerId, params.sellerId],
    });

    return { createdSellerBlocked, createdBuyerPaid };
  }

  /**
   * تعمیر سفارش DIRECT که پرداخت شده ولی بلوکه فروشنده / لاگ خریدار ثبت نشده.
   */
  async repairMissingPurchaseEscrow(
    orderId: string,
    opts?: { force?: boolean },
  ): Promise<{
    repaired: boolean;
    createdSellerBlocked: boolean;
    createdBuyerPaid: boolean;
    statusAdvanced: boolean;
    message: string;
  }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        checkoutSession: {
          select: {
            id: true,
            status: true,
            paymentAuthority: true,
          },
        },
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.type !== OrderType.DIRECT) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message: 'این repair فقط برای فروش مستقیم است.',
      };
    }
    if (order.status === OrderStatus.CANCELLED) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message: 'سفارش لغو شده قابل تعمیر امانت خرید نیست.',
      };
    }
    if (order.status === OrderStatus.COMPLETED) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message:
          'سفارش تکمیل‌شده را نمی‌توان با این ابزار تعمیر کرد (نیاز به بررسی دستی آزادسازی دارد).',
      };
    }

    const paidAmount = Number(order.totalAmount || 0);
    if (paidAmount <= 0) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message: 'مبلغ سفارش صفر است؛ امانتی برای ثبت نیست.',
      };
    }

    const presence = await this.getPurchaseEscrowPresence(orderId);
    const awaitingPayment =
      order.status === OrderStatus.AWAITING_PAYMENT ||
      order.status === OrderStatus.PENDING;
    const sessionPaid =
      order.checkoutSession?.status === CheckoutSessionStatus.PAID;
    const hasAuthority = Boolean(
      order.checkoutSession?.paymentAuthority?.trim(),
    );
    const paymentEvidence =
      !awaitingPayment || sessionPaid || hasAuthority || Boolean(opts?.force);

    if (!paymentEvidence) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message:
          'شواهد پرداخت یافت نشد. اگر از پرداخت درگاه مطمئنید، با force=true دوباره تلاش کنید.',
      };
    }

    if (
      presence.sellerBlocked &&
      presence.buyerPaid &&
      !awaitingPayment
    ) {
      return {
        repaired: false,
        createdSellerBlocked: false,
        createdBuyerPaid: false,
        statusAdvanced: false,
        message: 'امانت خرید و لاگ مالی از قبل کامل است.',
      };
    }

    const platformCut = Math.max(
      0,
      paidAmount - Number(order.sellerRevenue || 0),
    );
    let createdSellerBlocked = false;
    let createdBuyerPaid = false;
    let statusAdvanced = false;

    await this.prisma.$transaction(async (tx) => {
      const ensured = await this.ensureGatewayPurchaseEscrowInTx(tx, {
        orderId: order.id,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingId: order.listingId,
        paidAmount,
        platformCut,
        paymentSource: 'REPAIR',
      });
      createdSellerBlocked = ensured.createdSellerBlocked;
      createdBuyerPaid = ensured.createdBuyerPaid;

      if (awaitingPayment) {
        const nextStatus = order.requiresVerification
          ? OrderStatus.AWAITING_SHIPMENT_TO_HUB
          : OrderStatus.PAID;
        const shipSetting = await tx.systemSetting.findFirst({
          where: {
            key: {
              in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'],
            },
          },
          orderBy: { key: 'asc' },
        });
        const parsed = Number(shipSetting?.value ?? '');
        const shipMinutes =
          Number.isFinite(parsed) && parsed > 0
            ? Math.floor(parsed)
            : 3 * 24 * 60;
        const deadline = new Date(Date.now() + shipMinutes * 60 * 1000);

        await tx.order.update({
          where: { id: order.id },
          data: { status: nextStatus, shippingDeadline: deadline },
        });
        statusAdvanced = true;

        if (order.checkoutSessionId) {
          await tx.checkoutSession.updateMany({
            where: {
              id: order.checkoutSessionId,
              status: { not: CheckoutSessionStatus.PAID },
            },
            data: { status: CheckoutSessionStatus.PAID },
          });
        }

        await decrementSoldStock(tx, {
          listingId: order.listingId,
          variationId: order.variationId,
          quantity: order.quantity ?? 1,
        });
      }
    });

    const repaired = createdSellerBlocked || createdBuyerPaid || statusAdvanced;
    return {
      repaired,
      createdSellerBlocked,
      createdBuyerPaid,
      statusAdvanced,
      message: repaired
        ? `امانت خرید تعمیر شد (فروشنده‌بلوکه=${createdSellerBlocked ? 'بله' : 'خیر'}، لاگ‌خریدار=${createdBuyerPaid ? 'بله' : 'خیر'}، وضعیت=${statusAdvanced ? 'به‌روز شد' : 'بدون تغییر'}).`
        : 'تغییری لازم نبود؛ امانت از قبل ثبت شده بود.',
    };
  }

  /**
   * پیدا کردن سفارش‌های DIRECT که لاگ امانت خرید ناقص دارند.
   */
  async findOrdersMissingPurchaseEscrow(limit = 100): Promise<
    Array<{
      id: string;
      status: string;
      totalAmount: number;
      sellerRevenue: number;
      checkoutSessionId: string | null;
      createdAt: Date;
      sellerBlocked: boolean;
      buyerPaid: boolean;
    }>
  > {
    const take = Math.min(Math.max(1, limit), 500);
    const candidates = await this.prisma.order.findMany({
      where: {
        type: OrderType.DIRECT,
        status: {
          notIn: [OrderStatus.CANCELLED, OrderStatus.COMPLETED],
        },
        OR: [
          {
            status: {
              notIn: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PENDING],
            },
          },
          {
            checkoutSession: {
              OR: [
                { status: CheckoutSessionStatus.PAID },
                { paymentAuthority: { not: null } },
              ],
            },
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: take * 3,
      select: {
        id: true,
        status: true,
        totalAmount: true,
        sellerRevenue: true,
        checkoutSessionId: true,
        createdAt: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
      },
    });

    const out: Array<{
      id: string;
      status: string;
      totalAmount: number;
      sellerRevenue: number;
      checkoutSessionId: string | null;
      createdAt: Date;
      sellerBlocked: boolean;
      buyerPaid: boolean;
    }> = [];

    for (const order of candidates) {
      if (out.length >= take) break;
      if (Number(order.totalAmount) <= 0) continue;
      const presence = await this.getPurchaseEscrowPresence(order.id, {
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        listingId: order.listingId,
      });
      const sellerNeeds =
        Number(order.sellerRevenue) > 0 && !presence.sellerBlocked;
      const buyerNeeds = !presence.buyerPaid;
      if (!sellerNeeds && !buyerNeeds) continue;
      out.push({
        id: order.id,
        status: order.status,
        totalAmount: Number(order.totalAmount),
        sellerRevenue: Number(order.sellerRevenue),
        checkoutSessionId: order.checkoutSessionId,
        createdAt: order.createdAt,
        sellerBlocked: presence.sellerBlocked,
        buyerPaid: presence.buyerPaid,
      });
    }
    return out;
  }
}
