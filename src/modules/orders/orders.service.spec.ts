import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from '../notification/notification.service';
import { OrderReputationService } from './order-reputation.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ListingStatus, OrderStatus, OrderType, WalletTransactionStatus, WalletTransactionType } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;

  const prismaMock = {
    order: { findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    systemSetting: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };

  const walletMock = {
    releaseEscrow: jest.fn(),
    refundExchangeExtraOnCancel: jest.fn(),
  };
  const feeMock = {};
  const appSettingsMock = { getApiUrl: jest.fn(), getPaymentGatewayConfig: jest.fn() };
  const paymentsMock = { initiateOrderPayment: jest.fn() };
  const notificationMock = { create: jest.fn() };
  const orderReputationMock = { recordTerminalOutcome: jest.fn() };
  const exchangeMock = { rejectNonWinningExchangeOffersAfterSale: jest.fn() };
  const stateMachineMock = {
    canTransition: jest.fn(),
    assertTransition: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        { provide: FeeCalculatorService, useValue: feeMock },
        { provide: AppSettingsService, useValue: appSettingsMock },
        { provide: OrdersStateMachineService, useValue: stateMachineMock },
        { provide: PaymentsService, useValue: paymentsMock },
        { provide: NotificationService, useValue: notificationMock },
        { provide: OrderReputationService, useValue: orderReputationMock },
        { provide: ExchangeService, useValue: exchangeMock },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('releases exchange escrow to buyer when seller is payer', async () => {
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'ord-1',
          type: 'EXCHANGE',
          buyerId: 'buyer-1',
          sellerId: 'seller-1',
          listingId: 'lst-1',
          exchangeOfferId: 'offer-1',
          status: 'SHIPPED_TO_BUYER',
          buyerConfirmedDelivery: false,
          sellerConfirmedDelivery: true,
          sellerRevenue: 500, // مقدار legacy اشتباه که نباید معیار باشد
          platformFee: 0,
          exchangeHubInspection: null,
          hubToBuyerTrackingCode: 'HB123',
          hubToSellerTrackingCode: 'HS123',
        }),
        update: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'ord-1',
            buyerConfirmedDelivery: true,
            sellerConfirmedDelivery: true,
          })
          .mockResolvedValueOnce({ id: 'ord-1', status: 'COMPLETED' }),
      },
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({
          extraPayment: 500,
          isPayerMe: false, // فروشنده payer است => خریدار باید دریافت کند
        }),
      },
      wallet: {
        findUnique: jest.fn().mockImplementation(async ({ where }: { where: { userId: string } }) => {
          if (where.userId === 'buyer-1') return { balanceBlocked: 500 };
          return { balanceBlocked: 0 };
        }),
      },
    };
    prismaMock.$transaction.mockImplementation(async (cb: (trx: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );

    await service.confirmOrder('buyer-1', 'ord-1');

    expect(walletMock.releaseEscrow).toHaveBeenCalledTimes(1);
    expect(walletMock.releaseEscrow).toHaveBeenCalledWith(
      'buyer-1',
      500,
      'lst-1',
      tx,
      { orderId: 'ord-1' },
    );
  });

  it('autoCancelExpiredOrders: one-side shipment timeout -> REJECTED_AT_HUB + refunds + penalize non-sender', async () => {
    const orderId = 'ord-ex-1';
    const listingId = 'lst-1';
    const buyerId = 'buyer-1';
    const sellerId = 'seller-1';
    const exchangeOfferId = 'offer-1';

    // seller sent, buyer not sent (sellerTrackingCode is null/undefined for buyer)
    const expiredOrder = {
      id: orderId,
      type: OrderType.EXCHANGE,
      buyerId,
      sellerId,
      listingId,
      exchangeOfferId,
      status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      trackingCode: 'HB-TRACK',
      sellerTrackingCode: null,
      sellerRevenue: 0,
      totalAmount: 0,
      verificationFee: 100,
      exchangeHubInspection: {},
      tradeReputationAt: null,
      // shippingDeadline is not used inside transaction; findMany will just return this record.
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({
          extraPayment: 200,
          isPayerMe: true, // payer = buyer, so buyerRefundable = 200
        }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({}),
      },
      walletTransaction: {
        create: jest.fn().mockResolvedValue({}),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        update: jest.fn().mockResolvedValue({}),
      },
      listing: {
        update: jest.fn().mockResolvedValue({ id: listingId, status: ListingStatus.APPROVED }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: (trx: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );

    walletMock.refundExchangeExtraOnCancel.mockResolvedValue(undefined);

    const creditSpy = jest
      .spyOn(service as any, 'creditExchangeCompensation')
      .mockResolvedValue(undefined);

    await service.autoCancelExpiredOrders();

    // Refund: only extra refund should happen to the payer (buyer) = non-sender here.
    expect(walletMock.refundExchangeExtraOnCancel).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        buyerId,
        sellerId,
        listingId,
        orderId,
        isPayerMe: true,
        buyerRefundable: 200,
        sellerRefundable: 0,
      }),
    );

    // Sender refund (seller sent) includes verification fee only (sellerShare = 100, because buyer pays extra).
    expect(tx.wallet.upsert).toHaveBeenCalledTimes(1);
    expect(tx.walletTransaction.create).toHaveBeenCalledTimes(1);
    expect(tx.walletTransaction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: WalletTransactionType.REFUND,
          status: WalletTransactionStatus.SUCCESS,
          amount: 100,
        }),
      }),
    );

    // 20% compensation for sender
    expect(creditSpy).toHaveBeenCalledWith(tx, sellerId, 20, orderId, 20);

    // State machine transition: we keep exchange in flow by marking REJECTED_AT_HUB
    expect(stateMachineMock.assertTransition).toHaveBeenCalledWith(
      expiredOrder.status,
      OrderStatus.REJECTED_AT_HUB,
      'auto-cancel-expired',
    );

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: orderId },
        data: expect.objectContaining({
          status: OrderStatus.REJECTED_AT_HUB,
          cancelReason: expect.stringContaining('عدم ارسال'),
          exchangeHubInspection: expect.objectContaining({
            resolution: 'RETURN_BOTH_TO_SENDERS',
            awaitingReturnConfirmations: false,
          }),
        }),
      }),
    );

    // Penalty only for non-sender (buyer)
    expect(orderReputationMock.recordTerminalOutcome).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: orderId, buyerId, sellerId }),
      expiredOrder.status,
      'FAILURE',
      expect.objectContaining({ failurePenalizeUserIds: [buyerId] }),
    );

    expect(tx.listing.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: listingId },
        data: { status: ListingStatus.APPROVED },
      }),
    );

    creditSpy.mockRestore();
  });

  it('autoConfirmOrders: includes SHIPPED_TO_BUYER in auto-confirm flow', async () => {
    const orderId = 'ord-auto-1';
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: orderId,
        type: OrderType.EXCHANGE,
        status: OrderStatus.SHIPPED_TO_BUYER,
      },
    ]);

    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue({
          id: orderId,
          type: OrderType.EXCHANGE,
          status: OrderStatus.SHIPPED_TO_BUYER,
          sellerId: 'seller-1',
          buyerId: 'buyer-1',
          listingId: 'lst-1',
          sellerRevenue: 200,
          platformFee: 0,
          tradeReputationAt: null,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ balanceBlocked: 200 }),
      },
    };

    prismaMock.$transaction.mockImplementation(async (cb: (trx: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );
    walletMock.releaseEscrow.mockResolvedValue(undefined);
    orderReputationMock.recordTerminalOutcome.mockResolvedValue(undefined);

    await service.autoConfirmOrders();

    expect(walletMock.releaseEscrow).toHaveBeenCalledWith(
      'seller-1',
      200,
      'lst-1',
      tx,
      { orderId },
    );
    expect(orderReputationMock.recordTerminalOutcome).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: orderId,
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
      }),
      OrderStatus.SHIPPED_TO_BUYER,
      'SUCCESS',
    );
  });

  describe('updateTrackingCode', () => {
    it('rejects invalid tracking code format', async () => {
      prismaMock.order.findUnique = jest.fn().mockResolvedValue({
        id: 'ord-1',
        type: OrderType.DIRECT,
        status: OrderStatus.PAID,
        sellerId: 'seller-1',
        buyerId: 'buyer-1',
        listingId: 'lst-1',
        trackingCode: null,
        sellerTrackingCode: null,
        listing: { sellerRequiresVerification: false },
      });
      prismaMock.order.update = jest.fn();

      await expect(
        service.updateTrackingCode('seller-1', 'ord-1', '123', 'video.mp4'),
      ).rejects.toThrow('کد رهگیری باید دقیقاً ۲۴ رقم باشد.');
    });

    it('requires packaging video', async () => {
      prismaMock.order.findUnique = jest.fn().mockResolvedValue({
        id: 'ord-1',
        type: OrderType.DIRECT,
        status: OrderStatus.PAID,
        sellerId: 'seller-1',
        buyerId: 'buyer-1',
        listingId: 'lst-1',
        trackingCode: null,
        sellerTrackingCode: null,
        listing: { sellerRequiresVerification: false },
      });
      prismaMock.order.update = jest.fn();

      await expect(
        service.updateTrackingCode('seller-1', 'ord-1', '123456789012345678901234'),
      ).rejects.toThrow('ویدیوی بسته‌بندی کالا الزامی است');
    });

    it('stores seller trackingCode + packagingVideo for direct orders', async () => {
      prismaMock.order.findUnique = jest.fn().mockResolvedValue({
        id: 'ord-1',
        type: OrderType.DIRECT,
        status: OrderStatus.PAID,
        sellerId: 'seller-1',
        buyerId: 'buyer-1',
        listingId: 'lst-1',
        trackingCode: null,
        sellerTrackingCode: null,
        requiresVerification: false,
        listing: { sellerRequiresVerification: false },
      });
      prismaMock.order.update = jest.fn().mockResolvedValue({ ok: true });

      await service.updateTrackingCode(
        'seller-1',
        'ord-1',
        '123456789012345678901234',
        'video-1.mp4',
      );

      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-1' },
        data: expect.objectContaining({
          trackingCode: '123456789012345678901234',
          packagingVideo: 'video-1.mp4',
          status: OrderStatus.SHIPPED,
        }),
      });
    });

    it('stores seller trackingCode + packagingVideo and sets SHIPPED when hub not needed', async () => {
      prismaMock.order.findUnique = jest.fn().mockResolvedValue({
        id: 'ord-2',
        type: OrderType.DIRECT,
        status: OrderStatus.PAID,
        sellerId: 'seller-1',
        buyerId: 'buyer-1',
        listingId: 'lst-2',
        trackingCode: null,
        sellerTrackingCode: null,
        requiresVerification: false,
        listing: { sellerRequiresVerification: false },
      });
      prismaMock.order.update = jest.fn().mockResolvedValue({ ok: true });

      await service.updateTrackingCode(
        'seller-1',
        'ord-2',
        '123456789012345678901234',
        'video-2.mp4',
      );

      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-2' },
        data: expect.objectContaining({
          trackingCode: '123456789012345678901234',
          packagingVideo: 'video-2.mp4',
          status: OrderStatus.SHIPPED,
        }),
      });
    });
  });
});
