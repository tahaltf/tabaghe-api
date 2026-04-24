import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ListingStatus,
  NotificationType,
  OrderStatus,
  Prisma,
  RepairRequestStatus,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentGateway } from './gateways/payment-gateway.interface';
import { ZibalGateway } from './gateways/zibal.gateway';
import { NotificationService } from '../notification/notification.service';

@Injectable()
export class PaymentsService {
  private static readonly WALLET_TOPUP_KIND = 'gateway-topup';

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly appSettings: AppSettingsService,
    private readonly zibalGateway: ZibalGateway,
    private readonly notificationService: NotificationService,
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
  ) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { buyer: { select: { phone: true } } },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');
    if (order.buyerId !== userId) {
      throw new BadRequestException('فقط خریدار می‌تواند پرداخت را آغاز کند');
    }
    if (order.status !== OrderStatus.AWAITING_PAYMENT && order.status !== OrderStatus.PENDING) {
      throw new BadRequestException('این سفارش در وضعیت قابل پرداخت نیست');
    }
    if (Number(order.totalAmount) <= 0) {
      throw new BadRequestException('مبلغ سفارش برای پرداخت درگاه معتبر نیست');
    }

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callbackUrl = `${callbackBase}?kind=ORDER&orderId=${order.id}`;
    const requested = await gateway.requestPayment({
      amount: Number(order.totalAmount),
      callbackUrl,
      orderId: order.id,
      description: `پرداخت سفارش ${order.id}`,
      mobile: order.buyer?.phone ?? undefined,
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
  ) {
    const repair = await this.prisma.repairRequest.findUnique({
      where: { id: repairId },
      include: { user: { select: { phone: true } } },
    });
    if (!repair) throw new NotFoundException('درخواست تعمیر یافت نشد');
    if (repair.userId !== userId) {
      throw new BadRequestException('فقط صاحب درخواست می‌تواند پرداخت را آغاز کند');
    }
    if (repair.status !== RepairRequestStatus.RESULT_READY || !repair.userCostApproved) {
      throw new BadRequestException('این درخواست در وضعیت قابل پرداخت نیست');
    }
    const amount = Number(repair.estimatedCost ?? 0);
    if (amount <= 0) {
      throw new BadRequestException('مبلغ تعمیر برای پرداخت درگاه معتبر نیست');
    }

    const gateway = this.getGateway();
    const callbackBase =
      callbackBaseUrl ?? this.appSettings.getPaymentGatewayConfig().callbackUrl;
    const callbackUrl = `${callbackBase}?kind=REPAIR&repairId=${repair.id}`;
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
    const callbackUrl = `${callbackBase}?kind=WALLET`;
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

  async processGatewayCallback(gatewayName: string, query: Record<string, unknown>) {
    if (gatewayName !== 'zibal') {
      throw new BadRequestException('درگاه نامعتبر است');
    }
    const kind = String(query.kind ?? 'ORDER').trim().toUpperCase();
    const orderId = String(query.orderId ?? '').trim();
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
    if (kind !== 'ORDER' && kind !== 'REPAIR' && kind !== 'WALLET') {
      throw new BadRequestException('نوع callback نامعتبر است');
    }

    if (kind === 'REPAIR') {
      return this.processRepairCallback({ repairId, authority, successFlag });
    }
    if (kind === 'WALLET') {
      return this.processWalletTopupCallback({ authority, successFlag });
    }
    return this.processOrderCallback({ orderId, authority, successFlag });
  }

  private async processOrderCallback(params: {
    orderId: string;
    authority: string;
    successFlag: string;
  }) {
    const { orderId, authority, successFlag } = params;

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('سفارش مرتبط با پرداخت پیدا نشد');

    if (order.status !== OrderStatus.AWAITING_PAYMENT && order.status !== OrderStatus.PENDING) {
      return {
        result: 'ALREADY_PROCESSED',
        ok: true,
        orderId: order.id,
        authority,
      };
    }

    if (!this.isGatewayCallbackSuccess(successFlag)) {
      return {
        result: 'CANCELLED_BY_USER',
        ok: false,
        orderId: order.id,
        authority,
      };
    }

    const verified = await this.getGateway().verifyPayment({
      authority,
      expectedAmount: Number(order.totalAmount),
    });

    if (!verified.success) {
      return {
        result: 'VERIFY_FAILED',
        ok: false,
        orderId: order.id,
        authority,
        message: verified.message,
      };
    }

    await this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const locked = await tx.order.findUnique({ where: { id: order.id } });
      if (!locked) throw new NotFoundException('سفارش یافت نشد');
      if (locked.status !== OrderStatus.AWAITING_PAYMENT && locked.status !== OrderStatus.PENDING) {
        return;
      }

      const totalAmount = Number(locked.totalAmount);
      const sellerRevenue = Number(locked.sellerRevenue);
      const platformCut = Math.max(0, totalAmount - sellerRevenue);

      await this.walletService.creditExternalPaymentToEscrow(
        locked.sellerId,
        totalAmount,
        platformCut,
        locked.listingId,
        tx,
      );

      const paidStatus =
        locked.requiresVerification || locked.type === 'EXCHANGE'
          ? OrderStatus.AWAITING_SHIPMENT_TO_HUB
          : OrderStatus.PAID;

      const deadline = new Date();
      deadline.setHours(deadline.getHours() + 72);

      await tx.order.update({
        where: { id: locked.id },
        data: {
          status: paidStatus,
          shippingDeadline: deadline,
        },
      });

      await tx.listing.update({
        where: { id: locked.listingId },
        data: { status: ListingStatus.SOLD },
      });
    });

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
    if (repair.status !== RepairRequestStatus.RESULT_READY || !repair.userCostApproved) {
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
      const locked = await tx.repairRequest.findUnique({ where: { id: repair.id } });
      if (!locked) throw new NotFoundException('درخواست تعمیر پیدا نشد');
      if (locked.status === RepairRequestStatus.IN_PROGRESS) return;
      if (locked.status !== RepairRequestStatus.RESULT_READY || !locked.userCostApproved) {
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
          { meta: { path: ['kind'], equals: PaymentsService.WALLET_TOPUP_KIND } },
        ],
      },
    });

    if (!transaction) {
      const processed = await this.prisma.walletTransaction.findFirst({
        where: {
          AND: [
            whereByAuthority,
            { status: WalletTransactionStatus.SUCCESS },
            { meta: { path: ['kind'], equals: PaymentsService.WALLET_TOPUP_KIND } },
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
      if (!locked || locked.status !== WalletTransactionStatus.PENDING) return null;

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
      await this.notificationService.create({
        userId: finalized.userId,
        type: NotificationType.SYSTEM,
        title: 'شارژ کیف پول موفق',
        message: 'پرداخت آنلاین شما با موفقیت انجام شد و کیف پول شارژ شد.',
        meta: {
          transactionId: finalized.transactionId,
          amount: finalized.amount,
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
}
