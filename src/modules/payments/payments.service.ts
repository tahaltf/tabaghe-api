import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionBidStatus,
  AuctionSettlementStatus,
  CheckoutSessionStatus,
  ListingStatus,
  NotificationType,
  OrderStatus,
  OrderType,
  Prisma,
  RepairRequestStatus,
  SecondChanceOfferStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentGateway } from './gateways/payment-gateway.interface';
import { ZibalGateway } from './gateways/zibal.gateway';
import { NotificationService } from '../notification/notification.service';
import { ExchangeOrderNotifyService } from '../notification/exchange-order-notify.service';
import { ExchangeService } from '../exchange/exchange.service';

@Injectable()
export class PaymentsService {
  private static readonly WALLET_TOPUP_KIND = 'gateway-topup';

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly appSettings: AppSettingsService,
    private readonly zibalGateway: ZibalGateway,
    private readonly notificationService: NotificationService,
    private readonly exchangeOrderNotify: ExchangeOrderNotifyService,
    private readonly exchangeService: ExchangeService,
  ) {}

  private getGateway(): PaymentGateway {
    const active = this.appSettings.getActivePaymentGateway();
    if (active === 'zibal') return this.zibalGateway;
    return this.zibalGateway;
  }

  async initiateOrderPayment(
    orderId: string,
    userId: string,
    callbackBaseUrl?: string,
    returnUrl?: string,
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: { select: { phone: true } },
        seller: { select: { phone: true } },
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    const isExchange = order.type === 'EXCHANGE';
    const isOrderBuyer = order.buyerId === userId;
    const isOrderSeller = order.sellerId === userId;
    if (!isExchange && !isOrderBuyer) {
      throw new BadRequestException('فقط خریدار می‌تواند پرداخت را آغاز کند');
    }
    if (isExchange && !isOrderBuyer && !isOrderSeller) {
      throw new BadRequestException(
        'فقط طرفین معاوضه می‌توانند پرداخت را آغاز کنند',
      );
    }
    if (order.status === OrderStatus.CANCELLED) {
      throw new BadRequestException(
        'مهلت پرداخت این معامله به پایان رسیده است؛ امکان پرداخت وجود ندارد',
      );
    }
    if (
      order.status !== OrderStatus.AWAITING_PAYMENT &&
      order.status !== OrderStatus.PENDING
    ) {
      throw new BadRequestException('این سفارش در وضعیت قابل پرداخت نیست');
    }

    let payableAmount = Number(order.totalAmount);
    if (isExchange) {
      payableAmount = await this.getExchangeParticipantDue(order.id, userId);
    }
    if (payableAmount <= 0) {
      throw new BadRequestException('مبلغ سفارش برای پرداخت درگاه معتبر نیست');
    }

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callback = new URL(callbackBase);
    callback.searchParams.set('kind', 'ORDER');
    callback.searchParams.set('orderId', order.id);
    callback.searchParams.set('payerId', userId);
    if (returnUrl) callback.searchParams.set('returnUrl', returnUrl);
    const callbackUrl = callback.toString();
    const requested = await gateway.requestPayment({
      amount: payableAmount,
      callbackUrl,
      orderId: order.id,
      description: `پرداخت سفارش ${order.id}`,
      mobile: isOrderBuyer
        ? (order.buyer?.phone ?? undefined)
        : (order.seller?.phone ?? undefined),
    });

    if (order.status === OrderStatus.PENDING) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: OrderStatus.AWAITING_PAYMENT },
      });
    }

    return {
      gateway: gateway.name,
      orderId: order.id,
      authority: requested.authority,
      paymentUrl: requested.paymentUrl,
    };
  }

  async initiateRepairPayment(
    repairId: string,
    userId: string,
    callbackBaseUrl?: string,
    returnUrl?: string,
  ) {
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id: repairId },
      include: { user: { select: { phone: true } } },
    });
    if (!repair) throw new NotFoundException('درخواست تعمیر یافت نشد');
    if (repair.userId !== userId) {
      throw new BadRequestException(
        'فقط صاحب درخواست می‌تواند پرداخت را آغاز کند',
      );
    }
    if (
      repair.status !== RepairRequestStatus.RESULT_READY ||
      !repair.userCostApproved
    ) {
      throw new BadRequestException('این درخواست در وضعیت قابل پرداخت نیست');
    }
    const amount = Number(repair.estimatedCost ?? 0);
    if (amount <= 0) {
      throw new BadRequestException('مبلغ تعمیر برای پرداخت درگاه معتبر نیست');
    }

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callback = new URL(callbackBase);
    callback.searchParams.set('kind', 'REPAIR');
    callback.searchParams.set('repairId', repair.id);
    if (returnUrl) callback.searchParams.set('returnUrl', returnUrl);
    const callbackUrl = callback.toString();
    const requested = await gateway.requestPayment({
      amount,
      callbackUrl,
      orderId: `repair-${repair.id}`,
      description: `پرداخت هزینه تعمیر ${repair.trackingCode}`,
      mobile: repair.user?.phone ?? undefined,
    });

    return {
      gateway: gateway.name,
      repairId: repair.id,
      authority: requested.authority,
      paymentUrl: requested.paymentUrl,
    };
  }

  async initiateWalletTopup(
    userId: string,
    amountRaw: number,
    callbackBaseUrl?: string,
    returnUrl?: string,
  ) {
    const amount = Number(amountRaw ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('مبلغ شارژ نامعتبر است');
    }
    if (amount < 10000) {
      throw new BadRequestException('حداقل مبلغ شارژ ۱۰,۰۰۰ تومان است');
    }

    const [wallet, user] = await Promise.all([
      this.walletService.getWalletByUserId(userId),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { phone: true },
      }),
    ]);

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callback = new URL(callbackBase);
    callback.searchParams.set('kind', 'WALLET');
    if (returnUrl) callback.searchParams.set('returnUrl', returnUrl);
    const callbackUrl = callback.toString();
    const requested = await gateway.requestPayment({
      amount,
      callbackUrl,
      orderId: `wallet-${wallet.id}-${Date.now()}`,
      description: 'شارژ آنلاین کیف پول',
      mobile: user?.phone ?? undefined,
    });

    await this.prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        amount,
        type: WalletTransactionType.DEPOSIT,
        status: WalletTransactionStatus.PENDING,
        meta: {
          kind: PaymentsService.WALLET_TOPUP_KIND,
          authority: requested.authority,
          paymentSource: 'GATEWAY',
          description: 'شارژ آنلاین کیف پول (در انتظار تایید درگاه)',
        },
      },
    });

    return {
      gateway: gateway.name,
      authority: requested.authority,
      paymentUrl: requested.paymentUrl,
    };
  }

  async initiateCheckoutSessionPayment(
    sessionId: string,
    userId: string,
    callbackBaseUrl?: string,
    returnUrl?: string,
  ) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: {
        orders: true,
        buyer: { select: { phone: true } },
      },
    });
    if (!session) throw new NotFoundException('جلسه پرداخت یافت نشد');
    if (session.buyerId !== userId) {
      throw new BadRequestException('دسترسی به این پرداخت مجاز نیست');
    }
    if (session.status !== CheckoutSessionStatus.PENDING) {
      throw new BadRequestException('این جلسه پرداخت قابل پرداخت نیست');
    }
    const payableAmount = Number(session.totalAmount);
    if (payableAmount <= 0) {
      throw new BadRequestException('مبلغ پرداخت معتبر نیست');
    }

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callback = new URL(callbackBase);
    callback.searchParams.set('kind', 'CHECKOUT_SESSION');
    callback.searchParams.set('sessionId', session.id);
    callback.searchParams.set('orderId', session.id);
    callback.searchParams.set('payerId', userId);
    if (returnUrl) callback.searchParams.set('returnUrl', returnUrl);

    const requested = await gateway.requestPayment({
      amount: payableAmount,
      callbackUrl: callback.toString(),
      orderId: `cart-${session.id}`,
      description: `پرداخت سبد خرید`,
      mobile: session.buyer?.phone ?? undefined,
    });

    await this.prisma.checkoutSession.update({
      where: { id: session.id },
      data: {
        paymentAuthority: requested.authority,
        status: CheckoutSessionStatus.PENDING,
      },
    });

    for (const order of session.orders) {
      if (
        order.status === OrderStatus.PENDING ||
        order.status === OrderStatus.AWAITING_PAYMENT
      ) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: { status: OrderStatus.AWAITING_PAYMENT },
        });
      }
    }

    return {
      gateway: gateway.name,
      sessionId: session.id,
      authority: requested.authority,
      paymentUrl: requested.paymentUrl,
    };
  }

  private async processCheckoutSessionCallback(params: {
    sessionId: string;
    authority: string;
    successFlag: string;
    payerId?: string;
  }) {
    const { sessionId, authority, successFlag } = params;
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: true },
    });
    if (!session) throw new NotFoundException('جلسه پرداخت یافت نشد');

    const normalizedSuccess = String(successFlag ?? '').trim();
    if (
      normalizedSuccess.length > 0 &&
      !this.isGatewayCallbackSuccess(normalizedSuccess)
    ) {
      await this.rollbackCheckoutSession(session.id);
      return {
        result: 'CANCELLED_BY_USER',
        ok: false,
        kind: 'CHECKOUT_SESSION',
        sessionId: session.id,
        authority,
      };
    }

    const verified = await this.getGateway().verifyPayment({
      authority,
      expectedAmount: Number(session.totalAmount),
    });
    if (!verified.success) {
      await this.rollbackCheckoutSession(session.id);
      return {
        result: 'NOT_PAID',
        ok: false,
        kind: 'CHECKOUT_SESSION',
        sessionId: session.id,
        authority,
        message: verified.message,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await this.finalizeCheckoutSessionOrdersInTx(tx, session.id, 'GATEWAY');
    });

    await this.notifyCheckoutSessionPaid(session.id);

    return {
      result: 'PAID',
      ok: true,
      kind: 'CHECKOUT_SESSION',
      sessionId: session.id,
      orderIds: session.orders.map((o) => o.id),
      authority,
    };
  }

  /**
   * تسویه جلسه پرداخت از کیف پول خریدار (بدون درگاه).
   * مبالغ سفارش‌ها باید از قبل نهایی شده باشند.
   */
  async settleCheckoutSessionFromWallet(sessionId: string, userId: string) {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: true },
    });
    if (!session) throw new NotFoundException('جلسه پرداخت یافت نشد');
    if (session.buyerId !== userId) {
      throw new BadRequestException('دسترسی به این پرداخت مجاز نیست');
    }
    if (session.status !== CheckoutSessionStatus.PENDING) {
      throw new BadRequestException('این جلسه پرداخت قابل تسویه نیست');
    }

    const payable = Number(session.totalAmount);
    if (payable > 0) {
      const wallet = await this.prisma.wallet.findUnique({
        where: { userId },
      });
      if (!wallet || Number(wallet.balanceAvailable) < payable) {
        throw new BadRequestException('موجودی کیف پول برای خرید کافی نیست');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await this.finalizeCheckoutSessionOrdersInTx(tx, session.id, 'WALLET');
    });

    await this.notifyCheckoutSessionPaid(session.id);

    return {
      result: 'PAID',
      ok: true,
      kind: 'CHECKOUT_SESSION',
      sessionId: session.id,
      orderIds: session.orders.map((o) => o.id),
    };
  }

  private async finalizeCheckoutSessionOrdersInTx(
    tx: Prisma.TransactionClient,
    sessionId: string,
    paymentSource: 'GATEWAY' | 'WALLET',
  ) {
    const session = await tx.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: true },
    });
    if (!session) throw new NotFoundException('جلسه پرداخت یافت نشد');
    if (session.status === CheckoutSessionStatus.PAID) return;

    await tx.checkoutSession.update({
      where: { id: session.id },
      data: { status: CheckoutSessionStatus.PAID },
    });

    const shipDeadlineMinutes = await this.getSellerShipDeadlineMinutes(tx);
    const deadline = new Date(Date.now() + shipDeadlineMinutes * 60 * 1000);

    for (const order of session.orders) {
      if (
        order.status !== OrderStatus.AWAITING_PAYMENT &&
        order.status !== OrderStatus.PENDING
      ) {
        continue;
      }
      const locked = await tx.order.findUnique({ where: { id: order.id } });
      if (!locked) continue;
      const paidAmount = Number(locked.totalAmount);
      const nextStatus = locked.requiresVerification
        ? OrderStatus.AWAITING_SHIPMENT_TO_HUB
        : OrderStatus.PAID;

      if (paidAmount <= 0) {
        await tx.order.update({
          where: { id: locked.id },
          data: { status: nextStatus, shippingDeadline: deadline },
        });
        continue;
      }

      const platformCut = Math.max(
        0,
        paidAmount - Number(locked.sellerRevenue),
      );
      const listing = await tx.listing.findUnique({
        where: { id: locked.listingId },
        select: { title: true, stockQuantity: true },
      });
      const listingTitle = listing?.title;

      if (paymentSource === 'WALLET') {
        await this.walletService.transferToEscrow(
          locked.buyerId,
          locked.sellerId,
          paidAmount,
          platformCut,
          locked.listingId,
          tx,
          { orderId: locked.id },
        );
      } else {
        await this.walletService.creditExternalPaymentToEscrow(
          locked.sellerId,
          paidAmount,
          platformCut,
          locked.listingId,
          tx,
          { orderId: locked.id },
        );
        const payerWallet = await tx.wallet.upsert({
          where: { userId: locked.buyerId },
          create: {
            userId: locked.buyerId,
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
            referenceId: locked.listingId,
            meta: {
              kind: 'order-escrow',
              phase: 'buyer_paid',
              orderId: locked.id,
              listingId: locked.listingId,
              ...(listingTitle ? { listingTitle } : {}),
              paymentSource: 'GATEWAY',
              description: listingTitle
                ? `پرداخت خرید برای «${listingTitle}» از درگاه ثبت شد.`
                : 'پرداخت خرید از درگاه ثبت شد.',
            },
          },
        });
      }

      await this.walletService.linkEscrowDepositsToOrder(tx, {
        orderId: locked.id,
        listingId: locked.listingId,
        userIds: [locked.buyerId, locked.sellerId],
      });

      await tx.order.update({
        where: { id: locked.id },
        data: { status: nextStatus, shippingDeadline: deadline },
      });

      const purchasedQty = locked.quantity ?? 1;
      const nextStock = Math.max(
        0,
        (listing?.stockQuantity ?? 1) - purchasedQty,
      );
      await tx.listing.update({
        where: { id: locked.listingId },
        data: {
          stockQuantity: nextStock,
          status:
            nextStock <= 0 ? ListingStatus.SOLD : ListingStatus.APPROVED,
        },
      });
    }
  }

  private async notifyCheckoutSessionPaid(sessionId: string): Promise<void> {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: {
        orders: {
          select: {
            id: true,
            buyerId: true,
            sellerId: true,
            listingId: true,
            status: true,
          },
        },
      },
    });
    if (!session) return;
    for (const order of session.orders) {
      if (
        order.status === OrderStatus.PAID ||
        order.status === OrderStatus.AWAITING_SHIPMENT_TO_HUB
      ) {
        await this.notifyOrderPurchasedAndSold(order);
      }
    }
  }

  private async rollbackCheckoutSession(sessionId: string): Promise<void> {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: true },
    });
    if (!session) return;
    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { status: CheckoutSessionStatus.CANCELLED },
    });
    for (const order of session.orders) {
      await this.rollbackUnpaidGatewayOrder(order.id);
    }
  }

  async processGatewayCallback(
    gatewayName: string,
    query: Record<string, unknown>,
  ) {
    if (gatewayName !== 'zibal') {
      throw new BadRequestException('درگاه نامعتبر است');
    }
    const kind = String(query.kind ?? 'ORDER')
      .trim()
      .toUpperCase();
    const orderId = String(query.orderId ?? '').trim();
    const payerId = String(query.payerId ?? '').trim();
    const repairId = String(query.repairId ?? '').trim();
    const authority = String(query.trackId ?? query.authority ?? '').trim();
    const successFlag = String(query.success ?? '').trim();

    if (!authority) {
      throw new BadRequestException('پارامترهای بازگشت درگاه ناقص است');
    }
    if (kind === 'ORDER' && !orderId) {
      throw new BadRequestException('شناسه سفارش در callback ارسال نشده است');
    }
    if (kind === 'REPAIR' && !repairId) {
      throw new BadRequestException('شناسه تعمیر در callback ارسال نشده است');
    }
    if (kind !== 'ORDER' && kind !== 'REPAIR' && kind !== 'WALLET' && kind !== 'CHECKOUT_SESSION') {
      throw new BadRequestException('نوع callback نامعتبر است');
    }

    if (kind === 'CHECKOUT_SESSION') {
      const sessionId = String(query.sessionId ?? orderId).trim();
      if (!sessionId) {
        throw new BadRequestException('شناسه جلسه پرداخت در callback ارسال نشده است');
      }
      return this.processCheckoutSessionCallback({
        sessionId,
        authority,
        successFlag,
        payerId,
      });
    }

    if (kind === 'REPAIR') {
      return this.processRepairCallback({ repairId, authority, successFlag });
    }
    if (kind === 'WALLET') {
      return this.processWalletTopupCallback({ authority, successFlag });
    }
    return this.processOrderCallback({
      orderId,
      authority,
      successFlag,
      payerId,
    });
  }

  private async getSellerShipDeadlineMinutes(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const setting = await tx.systemSetting.findFirst({
      where: {
        key: {
          in: ['SELLER_SHIP_DEADLINE_MINUTES', 'SELLER_SHIP_DEADLINE_DAYS'],
        },
      },
      orderBy: { key: 'asc' },
    });
    const parsed = Number(setting?.value ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) return 3 * 24 * 60;
    return Math.floor(parsed);
  }

  private async getExchangeShipDeadlineMinutes(
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const minutesSetting = await tx.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIP_DEADLINE_MINUTES' },
    });
    if (minutesSetting?.value?.trim()) {
      const parsed = Number(minutesSetting.value);
      if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
    }
    const hoursSetting = await tx.systemSetting.findUnique({
      where: { key: 'EXCHANGE_SHIPMENT_TIMEOUT_HOURS' },
    });
    const hours = Number(hoursSetting?.value ?? '');
    if (Number.isFinite(hours) && hours > 0) return Math.floor(hours * 60);
    return 48 * 60;
  }

  /**
   * وقتی verify می‌گوید پرداخت انجام نشده، سفارش نیمه‌کاره را حذف می‌کند تا
   * آگهی در وضعیت «در جریان» نماند. معاوضه: اگر حداقل یک پرداخت ثبت شده باشد
   * (totalAmount > 0) دست نمی‌زند.
   */
  private async rollbackUnpaidGatewayOrder(orderId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const locked = await tx.order.findUnique({ where: { id: orderId } });
      if (!locked) return;
      if (
        locked.status !== OrderStatus.AWAITING_PAYMENT &&
        locked.status !== OrderStatus.PENDING
      ) {
        return;
      }
      if (
        locked.type === OrderType.EXCHANGE &&
        Number(locked.totalAmount ?? 0) > 0
      ) {
        return;
      }
      if (locked.type === OrderType.AUCTION) {
        await tx.secondChanceOffer.updateMany({
          where: {
            listingId: locked.listingId,
            userId: locked.buyerId,
            status: SecondChanceOfferStatus.ACCEPTED,
          },
          data: {
            status: SecondChanceOfferStatus.OFFERED,
            acceptedAt: null,
          },
        });
      }
      await tx.order.delete({ where: { id: locked.id } });
    });
  }

  private async processOrderCallback(params: {
    orderId: string;
    authority: string;
    successFlag: string;
    payerId?: string;
  }) {
    const { orderId, authority, payerId, successFlag } = params;

    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('سفارش مرتبط با پرداخت پیدا نشد');

    if (order.status === OrderStatus.CANCELLED) {
      return {
        result: 'INVALID_STATE',
        ok: false,
        kind: 'ORDER',
        orderId: order.id,
        authority,
        message:
          'مهلت پرداخت این معامله به پایان رسیده است. در صورت کسر وجه، با پشتیبانی تماس بگیرید.',
      };
    }
    if (
      order.status !== OrderStatus.AWAITING_PAYMENT &&
      order.status !== OrderStatus.PENDING
    ) {
      return {
        result: 'ALREADY_PROCESSED',
        ok: true,
        kind: 'ORDER',
        orderId: order.id,
        authority,
      };
    }

    if (order.type === OrderType.EXCHANGE && !String(payerId ?? '').trim()) {
      throw new BadRequestException(
        'پارامتر payerId در بازگشت درگاه برای سفارش معاوضه الزامی است',
      );
    }

    // اگر درگاه پارامتر success را صریحاً «ناموفق» فرستاده، قبل از verify سفارش نیمه‌کاره باز شود.
    // (repair/wallet قبلاً همین الگو را دارند؛ برای سفارش هم از verify اشتباه جلوگیری می‌کند.)
    const normalizedSuccess = String(successFlag ?? '').trim();
    if (
      normalizedSuccess.length > 0 &&
      !this.isGatewayCallbackSuccess(normalizedSuccess)
    ) {
      await this.rollbackUnpaidGatewayOrder(order.id);
      const orderStillExists = await this.prisma.order.findUnique({
        where: { id: order.id },
        select: { id: true },
      });
      return {
        result: 'CANCELLED_BY_USER',
        ok: false,
        kind: 'ORDER',
        ...(orderStillExists ? { orderId: orderStillExists.id } : {}),
        authority,
        message: 'پرداخت توسط کاربر لغو یا ناموفق اعلام شد.',
      };
    }

    const expectedAmount =
      order.type === OrderType.EXCHANGE
        ? await this.getExchangeParticipantDue(
            order.id,
            String(payerId ?? '').trim(),
          )
        : Number(order.totalAmount);

    const verified = await this.getGateway().verifyPayment({
      authority,
      expectedAmount,
    });

    if (!verified.success) {
      await this.rollbackUnpaidGatewayOrder(order.id);
      const orderStillExists = await this.prisma.order.findUnique({
        where: { id: order.id },
        select: { id: true },
      });
      return {
        result: 'NOT_PAID',
        ok: false,
        kind: 'ORDER',
        ...(orderStillExists ? { orderId: orderStillExists.id } : {}),
        authority,
        message: verified.message,
      };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.order.findUnique({ where: { id: order.id } });
      if (!locked) throw new NotFoundException('سفارش یافت نشد');
      if (
        locked.status !== OrderStatus.AWAITING_PAYMENT &&
        locked.status !== OrderStatus.PENDING
      ) {
        return;
      }

      const paidAmount = expectedAmount;
      let payeeUserId = locked.sellerId;
      let platformCut = Math.max(
        0,
        Number(locked.totalAmount) - Number(locked.sellerRevenue),
      );
      const isExchangeOrder = locked.type === 'EXCHANGE';
      let blockedAmount = paidAmount;
      if (locked.type === 'EXCHANGE' && payerId) {
        const payerIsBuyer = payerId === locked.buyerId;
        const payerIsSeller = payerId === locked.sellerId;
        if (!payerIsBuyer && !payerIsSeller) {
          throw new BadRequestException('پرداخت‌کننده این سفارش معتبر نیست');
        }
        // در معاوضه، پرداخت هر طرف به‌نفع طرف مقابل بلوکه می‌شود.
        payeeUserId = payerIsBuyer ? locked.sellerId : locked.buyerId;
        // در معاوضه، مبلغ پرداختی باید کامل برای طرف مقابل بلوکه شود
        // و نباید از لاگ بلوکه‌ی امانی کارمزدی کسر شود.
        platformCut = 0;
        blockedAmount = Math.max(
          0,
          paidAmount - Number(locked.verificationFee || 0),
        );
      }

      const listing = await tx.listing.findUnique({
        where: { id: locked.listingId },
        select: { title: true },
      });
      const listingTitle = listing?.title;

      if (locked.type === OrderType.AUCTION) {
        const winnerBid = await tx.auctionBid.findFirst({
          where: {
            listingId: locked.listingId,
            bidderId: locked.buyerId,
            status: AuctionBidStatus.ACTIVE,
          },
          orderBy: { amount: 'desc' },
        });
        const blockedDeposit = Number(winnerBid?.blockedAmount ?? 0);

        await this.walletService.settleAuctionGatewayPayment(
          {
            buyerId: locked.buyerId,
            sellerId: locked.sellerId,
            listingId: locked.listingId,
            orderId: locked.id,
            gatewayPaidAmount: paidAmount,
            sellerRevenue: Number(locked.sellerRevenue),
            blockedDeposit,
            listingTitle: listingTitle ?? undefined,
          },
          tx,
        );
        await this.walletService.linkEscrowDepositsToOrder(tx, {
          orderId: locked.id,
          listingId: locked.listingId,
          userIds: [locked.buyerId, locked.sellerId],
        });

        const otherActiveBids = await tx.auctionBid.findMany({
          where: {
            listingId: locked.listingId,
            status: AuctionBidStatus.ACTIVE,
            bidderId: { not: locked.buyerId },
          },
        });
        for (const bid of otherActiveBids) {
          const blocked = Number(bid.blockedAmount || 0);
          if (blocked > 0) {
            await this.walletService.unblockAmount(
              bid.bidderId,
              blocked,
              locked.listingId,
              tx,
            );
          }
          await tx.auctionBid.update({
            where: { id: bid.id },
            data: { status: AuctionBidStatus.LOST, blockedAmount: 0 },
          });
        }
        if (winnerBid) {
          await tx.auctionBid.update({
            where: { id: winnerBid.id },
            data: { status: AuctionBidStatus.WON, blockedAmount: 0 },
          });
        }
        await tx.listingAuction.update({
          where: { listingId: locked.listingId },
          data: { settlementStatus: AuctionSettlementStatus.PAID },
        });
      } else {
        await this.walletService.creditExternalPaymentToEscrow(
          payeeUserId,
          paidAmount,
          platformCut,
          locked.listingId,
          tx,
          {
            isExchangeEscrow: isExchangeOrder,
            blockedAmount,
            orderId: locked.id,
          },
        );
        await this.walletService.linkEscrowDepositsToOrder(tx, {
          orderId: locked.id,
          listingId: locked.listingId,
          userIds: [locked.buyerId, locked.sellerId],
        });

        const payerUserId =
          locked.type === 'EXCHANGE' && payerId ? payerId : locked.buyerId;
        const payerWallet = await tx.wallet.upsert({
          where: { userId: payerUserId },
          create: {
            userId: payerUserId,
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
            referenceId: locked.listingId,
            meta: {
              kind: 'order-escrow',
              phase: isExchangeOrder
                ? 'exchange_participant_paid'
                : 'buyer_paid',
              ...(isExchangeOrder ? { payerUserId } : {}),
              orderId: locked.id,
              listingId: locked.listingId,
              ...(listingTitle ? { listingTitle } : {}),
              paymentSource: 'GATEWAY',
              description: isExchangeOrder
                ? listingTitle
                  ? `پرداخت سهم معاوضه (کارشناسی/مابه‌التفاوت) برای «${listingTitle}» از درگاه ثبت شد.`
                  : 'پرداخت سهم معاوضه (کارشناسی/مابه‌التفاوت) از درگاه ثبت شد.'
                : listingTitle
                  ? `پرداخت خرید برای «${listingTitle}» از درگاه ثبت شد.`
                  : 'پرداخت خرید از درگاه ثبت شد.',
            },
          },
        });
      }

      let paidStatus: OrderStatus =
        locked.requiresVerification || locked.type === 'EXCHANGE'
          ? OrderStatus.AWAITING_SHIPMENT_TO_HUB
          : OrderStatus.PAID;

      const shipDeadlineMinutes =
        locked.type === 'EXCHANGE'
          ? await this.getExchangeShipDeadlineMinutes(tx)
          : await this.getSellerShipDeadlineMinutes(tx);
      const deadline = new Date(Date.now() + shipDeadlineMinutes * 60 * 1000);

      if (locked.type === 'EXCHANGE') {
        const offer = locked.exchangeOfferId
          ? await tx.exchangeOffer.findUnique({
              where: { id: locked.exchangeOfferId },
              select: { isPayerMe: true, extraPayment: true },
            })
          : null;
        const verificationFee = Number(locked.verificationFee || 0);
        const extra = Number(offer?.extraPayment || 0);
        const buyerShare = verificationFee + (offer?.isPayerMe ? extra : 0);
        const sellerShare = verificationFee + (!offer?.isPayerMe ? extra : 0);
        const expectedTotal = buyerShare + sellerShare;
        const nextTotal = Number(locked.totalAmount || 0) + paidAmount;
        const bothPaid = nextTotal >= expectedTotal;
        paidStatus = bothPaid
          ? OrderStatus.AWAITING_SHIPMENT_TO_HUB
          : OrderStatus.AWAITING_PAYMENT;
      }

      const nextPaidTotal =
        locked.type === 'EXCHANGE'
          ? Number(locked.totalAmount || 0) + paidAmount
          : paidAmount;

      await tx.order.update({
        where: { id: locked.id },
        data: {
          status: paidStatus,
          totalAmount: nextPaidTotal,
          shippingDeadline: deadline,
        },
      });

      if (
        locked.type !== 'EXCHANGE' ||
        paidStatus === OrderStatus.AWAITING_SHIPMENT_TO_HUB
      ) {
        await tx.listing.update({
          where: { id: locked.listingId },
          data: { status: ListingStatus.SOLD },
        });
        if (
          locked.type === 'EXCHANGE' &&
          locked.exchangeOfferId &&
          paidStatus === OrderStatus.AWAITING_SHIPMENT_TO_HUB
        ) {
          await this.exchangeService.rejectNonWinningExchangeOffersAfterSale(
            tx,
            locked.listingId,
            locked.exchangeOfferId,
          );
        }
      }
    });

    const freshOrder = await this.prisma.order.findUnique({
      where: { id: order.id },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        listingId: true,
        status: true,
        type: true,
      },
    });

    if (freshOrder?.type === OrderType.EXCHANGE) {
      if (freshOrder.status === OrderStatus.AWAITING_SHIPMENT_TO_HUB) {
        await this.exchangeOrderNotify.notifyReadyToShip(freshOrder);
      } else if (
        freshOrder.status === OrderStatus.AWAITING_PAYMENT &&
        payerId
      ) {
        await this.exchangeOrderNotify.notifyParticipantPaid(
          freshOrder,
          String(payerId).trim(),
        );
      }
    } else if (freshOrder) {
      await this.notifyOrderPurchasedAndSold(freshOrder);
    }

    return {
      result: 'PAID',
      ok: true,
      kind: 'ORDER',
      orderId: order.id,
      authority,
      refId: verified.refId,
    };
  }

  private async processRepairCallback(params: {
    repairId: string;
    authority: string;
    successFlag: string;
  }) {
    const { repairId, authority, successFlag } = params;
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id: repairId },
    });
    if (!repair) throw new NotFoundException('درخواست تعمیر پیدا نشد');

    if (repair.status === RepairRequestStatus.IN_PROGRESS) {
      return {
        result: 'ALREADY_PROCESSED',
        ok: true,
        kind: 'REPAIR',
        repairId: repair.id,
        authority,
      };
    }
    if (
      repair.status !== RepairRequestStatus.RESULT_READY ||
      !repair.userCostApproved
    ) {
      return {
        result: 'INVALID_STATE',
        ok: false,
        kind: 'REPAIR',
        repairId: repair.id,
        authority,
      };
    }
    if (!this.isGatewayCallbackSuccess(successFlag)) {
      return {
        result: 'CANCELLED_BY_USER',
        ok: false,
        kind: 'REPAIR',
        repairId: repair.id,
        authority,
      };
    }

    const expectedAmount = Number(repair.estimatedCost ?? 0);
    const verified = await this.getGateway().verifyPayment({
      authority,
      expectedAmount,
    });
    if (!verified.success) {
      return {
        result: 'VERIFY_FAILED',
        ok: false,
        kind: 'REPAIR',
        repairId: repair.id,
        authority,
        message: verified.message,
      };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.repairRequest.findUnique({
        where: { id: repair.id },
      });
      if (!locked) throw new NotFoundException('درخواست تعمیر پیدا نشد');
      if (locked.status === RepairRequestStatus.IN_PROGRESS) return;
      if (
        locked.status !== RepairRequestStatus.RESULT_READY ||
        !locked.userCostApproved
      ) {
        throw new BadRequestException('وضعیت پرداخت تعمیر نامعتبر است');
      }

      await tx.repairRequest.update({
        where: { id: locked.id },
        data: { status: RepairRequestStatus.IN_PROGRESS },
      });

      const wallet = await tx.wallet.upsert({
        where: { userId: locked.userId },
        create: {
          userId: locked.userId,
          balanceAvailable: 0,
          balanceBlocked: 0,
        },
        update: {},
      });

      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id,
          type: WalletTransactionType.SETTLEMENT,
          status: WalletTransactionStatus.SUCCESS,
          amount: expectedAmount,
          referenceId: locked.id,
          meta: {
            kind: 'repair-payment',
            repairId: locked.id,
            repairTrackingCode: locked.trackingCode,
            paymentSource: 'GATEWAY',
            authority,
            refId: verified.refId ?? null,
            description: 'پرداخت هزینه تعمیرات',
          },
        },
      });
    });

    return {
      result: 'PAID',
      ok: true,
      kind: 'REPAIR',
      repairId: repair.id,
      authority,
      refId: verified.refId,
    };
  }

  private async processWalletTopupCallback(params: {
    authority: string;
    successFlag: string;
  }) {
    const { authority, successFlag } = params;
    const whereByAuthority: Prisma.WalletTransactionWhereInput = {
      type: WalletTransactionType.DEPOSIT,
      meta: { path: ['authority'], equals: authority },
    };

    const transaction = await this.prisma.walletTransaction.findFirst({
      where: {
        AND: [
          whereByAuthority,
          { status: WalletTransactionStatus.PENDING },
          {
            meta: { path: ['kind'], equals: PaymentsService.WALLET_TOPUP_KIND },
          },
        ],
      },
    });

    if (!transaction) {
      const processed = await this.prisma.walletTransaction.findFirst({
        where: {
          AND: [
            whereByAuthority,
            { status: WalletTransactionStatus.SUCCESS },
            {
              meta: {
                path: ['kind'],
                equals: PaymentsService.WALLET_TOPUP_KIND,
              },
            },
          ],
        },
      });
      if (processed) {
        return {
          result: 'ALREADY_PROCESSED',
          ok: true,
          kind: 'WALLET',
          authority,
        };
      }
      throw new NotFoundException('تراکنش شارژ کیف پول پیدا نشد');
    }

    if (!this.isGatewayCallbackSuccess(successFlag)) {
      await this.prisma.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          status: WalletTransactionStatus.FAILED,
          meta: {
            ...(transaction.meta as Record<string, unknown>),
            failedAt: new Date().toISOString(),
            failureReason: 'cancelled-by-user',
          },
        },
      });
      return {
        result: 'CANCELLED_BY_USER',
        ok: false,
        kind: 'WALLET',
        authority,
      };
    }

    const verified = await this.getGateway().verifyPayment({
      authority,
      expectedAmount: Number(transaction.amount),
    });
    if (!verified.success) {
      await this.prisma.walletTransaction.update({
        where: { id: transaction.id },
        data: {
          status: WalletTransactionStatus.FAILED,
          meta: {
            ...(transaction.meta as Record<string, unknown>),
            failedAt: new Date().toISOString(),
            failureReason: verified.message ?? 'verify-failed',
          },
        },
      });
      return {
        result: 'VERIFY_FAILED',
        ok: false,
        kind: 'WALLET',
        authority,
        message: verified.message,
      };
    }

    const finalized = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.walletTransaction.findUnique({
        where: { id: transaction.id },
      });
      if (!locked || locked.status !== WalletTransactionStatus.PENDING)
        return null;

      await tx.wallet.update({
        where: { id: locked.walletId },
        data: { balanceAvailable: { increment: String(locked.amount) } },
      });

      await tx.walletTransaction.update({
        where: { id: locked.id },
        data: {
          status: WalletTransactionStatus.SUCCESS,
          meta: {
            ...(locked.meta as Record<string, unknown>),
            approvedAt: new Date().toISOString(),
            refId: verified.refId ?? null,
            description:
              'شارژ آنلاین کیف پول با موفقیت انجام شد و مبلغ به موجودی قابل برداشت اضافه شد.',
          },
        },
      });

      const wallet = await tx.wallet.findUnique({
        where: { id: locked.walletId },
        select: { userId: true },
      });
      return {
        userId: wallet?.userId ?? null,
        amount: Number(locked.amount),
        transactionId: locked.id,
      };
    });

    if (finalized?.userId) {
      await this.notificationService.createUserOperational({
        userId: finalized.userId,
        type: NotificationType.WALLET_TOPUP,
        title: 'شارژ کیف پول موفق',
        message: 'پرداخت آنلاین شما با موفقیت انجام شد و کیف پول شارژ شد.',
        meta: {
          transactionId: finalized.transactionId,
          amount: finalized.amount,
          userId: finalized.userId,
          refId: verified.refId ?? null,
          authority,
        },
      });
    }

    return {
      result: 'PAID',
      ok: true,
      kind: 'WALLET',
      authority,
      refId: verified.refId,
    };
  }

  private isGatewayCallbackSuccess(successFlag: string): boolean {
    const normalized = successFlag.trim().toLowerCase();
    return normalized === '1' || normalized === 'true';
  }

  private async getExchangeParticipantDue(
    orderId: string,
    payerId: string,
  ): Promise<number> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        buyerId: true,
        sellerId: true,
        verificationFee: true,
        exchangeOfferId: true,
      },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (!order.exchangeOfferId) {
      throw new BadRequestException(
        'شناسه پیشنهاد معاوضه برای این سفارش موجود نیست',
      );
    }
    const offer = await this.prisma.exchangeOffer.findUnique({
      where: { id: order.exchangeOfferId },
      select: { isPayerMe: true, extraPayment: true },
    });
    if (!offer) throw new NotFoundException('پیشنهاد معاوضه یافت نشد');

    const verification = Number(order.verificationFee || 0);
    const extra = Number(offer.extraPayment || 0);
    if (payerId === order.buyerId)
      return verification + (offer.isPayerMe ? extra : 0);
    if (payerId === order.sellerId)
      return verification + (!offer.isPayerMe ? extra : 0);
    throw new BadRequestException('پرداخت‌کننده مجاز این سفارش نیست');
  }

  private async notifyOrderPurchasedAndSold(order: {
    id: string;
    buyerId: string;
    sellerId: string;
    listingId: string;
  }): Promise<void> {
    const [listing, orderRow] = await Promise.all([
      this.prisma.listing.findUnique({
        where: { id: order.listingId },
        select: { title: true },
      }),
      this.prisma.order.findUnique({
        where: { id: order.id },
        select: { totalAmount: true, finalPrice: true },
      }),
    ]);
    const listingTitle = listing?.title ?? 'کالا';
    const amount = Number(orderRow?.totalAmount ?? orderRow?.finalPrice ?? 0);
    const sharedMeta = {
      orderId: order.id,
      listingId: order.listingId,
      listingTitle,
      amount,
      totalAmount: amount,
      finalPrice: Number(orderRow?.finalPrice ?? 0),
    };

    await Promise.all([
      this.notificationService.create({
        userId: order.buyerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'خرید شما ثبت شد',
        message: `خرید شما برای «${listingTitle}» با موفقیت ثبت شد.`,
        meta: {
          ...sharedMeta,
          role: 'BUYER',
          status: 'PAID',
          phase: 'purchase_registered',
          phaseKey: 'purchase_registered',
        },
      }),
      this.notificationService.create({
        userId: order.sellerId,
        type: NotificationType.ORDER_STATUS_CHANGED,
        title: 'کالای شما فروخته شد',
        message: `کالای «${listingTitle}» با موفقیت فروخته شد.`,
        meta: {
          ...sharedMeta,
          role: 'SELLER',
          status: 'SOLD',
          statusLabel: 'فروخته شد',
          sellerOrderStatusFa: 'فروخته شد',
          phase: 'sale_registered',
          phaseKey: 'sale_registered',
        },
      }),
      this.notificationService.notifyAdminNewOrder({
        orderId: order.id,
        listingId: order.listingId,
        listingTitle,
        buyerId: order.buyerId,
        sellerId: order.sellerId,
        totalAmount: amount,
        orderType: 'DIRECT',
      }),
    ]);
  }
}
