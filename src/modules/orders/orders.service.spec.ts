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
import { QuotaService } from '../quota/quota.service';
import { ListingCommandService } from '../listing/services/listing-command.service';
import {
  ListingStatus,
  OrderStatus,
  OrderType,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;

  const prismaMock = {
    order: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    systemSetting: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
    },
    $transaction: jest.fn(),
  };

  const walletMock = {
    releaseEscrow: jest.fn(),
    transferToEscrow: jest.fn(),
    refundExchangeExtraOnCancel: jest.fn(),
    refundExchangeBothNoShipmentOnCancel: jest.fn(),
    refundExchangeOneSideNoShipmentOnCancel: jest.fn(),
    refundDirectOrderEscrowOnCancel: jest.fn(),
  };
  const feeMock = {};
  const appSettingsMock = {
    getApiUrl: jest.fn(),
    getPaymentGatewayConfig: jest.fn(),
  };
  const paymentsMock = { initiateOrderPayment: jest.fn() };
  const notificationMock = { create: jest.fn() };
  const orderReputationMock = { recordTerminalOutcome: jest.fn() };
  const exchangeMock = { rejectNonWinningExchangeOffersAfterSale: jest.fn() };
  const quotaMock = { releaseOnReject: jest.fn().mockResolvedValue(undefined) };
  const listingCommandMock = {
    rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
  };
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
        { provide: QuotaService, useValue: quotaMock },
        { provide: ListingCommandService, useValue: listingCommandMock },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('handleUniversalOrder EXCHANGE: removes stale cancelled listing order before create', async () => {
    const offerId = 'offer-new';
    const listingId = 'lst-1';
    const buyerId = 'buyer-1';
    const sellerId = 'seller-1';

    prismaMock.systemSetting.findUnique = jest
      .fn()
      .mockImplementation(({ where }: { where: { key: string } }) => {
        if (where.key === 'VERIFICATION_FEE') {
          return Promise.resolve({ value: '250000' });
        }
        if (where.key === 'PLATFORM_ADDRESS') {
          return Promise.resolve({ value: 'تهران' });
        }
        return Promise.resolve(null);
      });
    prismaMock.systemSetting.findFirst = jest.fn().mockResolvedValue(null);

    walletMock.transferToEscrow.mockResolvedValue(undefined);

    const tx = {
      systemSetting: {
        findUnique: jest.fn().mockImplementation(({ where }: { where: { key: string } }) => {
          if (where.key === 'VERIFICATION_FEE') {
            return Promise.resolve({ value: '250000' });
          }
          if (where.key === 'PLATFORM_ADDRESS') {
            return Promise.resolve({ value: 'تهران' });
          }
          return Promise.resolve(null);
        }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({
          id: offerId,
          status: 'ACCEPTED',
          listingId,
          offererId: buyerId,
          isPayerMe: false,
          extraPayment: 0,
          listing: { authorId: sellerId, categoryId: 'cat-1', direct: null },
        }),
      },
      wallet: {
        upsert: jest.fn().mockResolvedValue({ balanceAvailable: 500000 }),
      },
      address: {
        findUnique: jest.fn().mockResolvedValue({
          province: 'تهران',
          city: 'تهران',
          fullAddress: 'خیابان 1',
          phone: '09120000000',
          postalCode: '1234567890',
        }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue({
          id: 'old-order',
          status: OrderStatus.CANCELLED,
          exchangeOfferId: null,
          totalAmount: 0,
        }),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({
          id: 'ord-new',
          type: OrderType.EXCHANGE,
          status: OrderStatus.AWAITING_PAYMENT,
          totalAmount: 0,
        }),
        update: jest.fn().mockResolvedValue({
          id: 'ord-new',
          type: OrderType.EXCHANGE,
          status: OrderStatus.AWAITING_PAYMENT,
          totalAmount: 250000,
        }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    const result = await service.handleUniversalOrder(buyerId, {
      orderType: 'EXCHANGE',
      paymentMethod: 'WALLET',
      exchangeOfferId: offerId,
      listingId,
      addressId: 'addr-1',
      requiresVerification: true,
    });

    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'old-order' } });
    expect(tx.order.create).toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: 'ord-new' },
      data: { totalAmount: 250000 },
    });
    expect(walletMock.transferToEscrow).toHaveBeenCalledWith(
      buyerId,
      sellerId,
      250000,
      0,
      listingId,
      tx,
      expect.objectContaining({
        isExchangeEscrow: true,
        orderId: 'ord-new',
      }),
    );
    expect(result.id).toBe('ord-new');
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
        findUnique: jest
          .fn()
          .mockImplementation(
            async ({ where }: { where: { userId: string } }) => {
              if (where.userId === 'buyer-1') return { balanceBlocked: 500 };
              return { balanceBlocked: 0 };
            },
          ),
      },
    };
    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
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
      shippingDeadline: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(Date.now() - 86_400_000),
      // shippingDeadline is not used inside transaction; findMany will just return this record.
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      exchangeOffer: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: {
        update: jest.fn().mockResolvedValue({}),
      },
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: OrderStatus.AWAITING_SHIPMENT_TO_HUB }),
        update: jest.fn().mockResolvedValue({}),
      },
      listing: {
        update: jest
          .fn()
          .mockResolvedValue({ id: listingId, status: ListingStatus.APPROVED }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundExchangeOneSideNoShipmentOnCancel.mockResolvedValue({
      senderRefund: 100,
      offenderRefund: 0,
      compensation: 20,
    });

    await service.autoCancelExpiredOrders();

    expect(walletMock.refundExchangeOneSideNoShipmentOnCancel).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId,
        listingId,
        buyerId,
        sellerId,
        senderId: sellerId,
        offenderId: buyerId,
        verificationFee: 100,
      }),
    );

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

    expect(tx.listing.update).toHaveBeenCalledWith({
      where: { id: listingId },
      data: { status: ListingStatus.APPROVED },
    });
  });

  it('autoCancelExpiredOrders: one-side timeout from SHIPPED_TO_HUB after first party ships', async () => {
    const orderId = 'ord-ex-shipped';
    const expiredOrder = {
      id: orderId,
      type: OrderType.EXCHANGE,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      exchangeOfferId: 'offer-1',
      status: OrderStatus.SHIPPED_TO_HUB,
      trackingCode: null,
      sellerTrackingCode: 'BUYER-TRACK-24DIGITS000000',
      sellerRevenue: 0,
      totalAmount: 0,
      verificationFee: 100,
      exchangeHubInspection: {},
      tradeReputationAt: null,
      shippingDeadline: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(Date.now() - 86_400_000),
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      exchangeOffer: {
        findUnique: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      user: { update: jest.fn().mockResolvedValue({}) },
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: OrderStatus.SHIPPED_TO_HUB }),
        update: jest.fn().mockResolvedValue({}),
      },
      listing: {
        update: jest
          .fn()
          .mockResolvedValue({ id: 'lst-1', status: ListingStatus.APPROVED }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundExchangeOneSideNoShipmentOnCancel.mockResolvedValue({
      senderRefund: 200,
      offenderRefund: 80,
      compensation: 20,
    });

    await service.autoCancelExpiredOrders();

    expect(stateMachineMock.assertTransition).toHaveBeenCalledWith(
      OrderStatus.SHIPPED_TO_HUB,
      OrderStatus.REJECTED_AT_HUB,
      'auto-cancel-expired',
    );
    expect(walletMock.refundExchangeOneSideNoShipmentOnCancel).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        senderId: 'buyer-1',
        offenderId: 'seller-1',
      }),
    );
  });

  it('autoCancelExpiredOrders: exchange both no shipment -> CANCELLED + per-party refunds + both penalized', async () => {
    const orderId = 'ord-ex-both';
    const listingId = 'lst-1';
    const buyerId = 'buyer-1';
    const sellerId = 'seller-1';
    const exchangeOfferId = 'offer-1';

    const expiredOrder = {
      id: orderId,
      type: OrderType.EXCHANGE,
      buyerId,
      sellerId,
      listingId,
      exchangeOfferId,
      status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      trackingCode: null,
      sellerTrackingCode: null,
      sellerRevenue: 200,
      totalAmount: 500_000,
      verificationFee: 100_000,
      exchangeHubInspection: {},
      tradeReputationAt: null,
      listing: { title: 'لپ‌تاپ' },
      shippingDeadline: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(Date.now() - 86_400_000),
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      exchangeOffer: {
        findUnique: jest.fn().mockResolvedValue({
          extraPayment: 200,
          isPayerMe: true,
        }),
      },
      wallet: { upsert: jest.fn() },
      walletTransaction: { create: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
      order: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: OrderStatus.AWAITING_SHIPMENT_TO_HUB }),
        update: jest.fn().mockResolvedValue({}),
      },
      ticket: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'ticket-buyer' })
          .mockResolvedValueOnce({ id: 'ticket-seller' }),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      listing: {
        update: jest
          .fn()
          .mockResolvedValue({ id: listingId, status: ListingStatus.REJECTED }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundExchangeBothNoShipmentOnCancel.mockResolvedValue({
      buyerPaid: 400_000,
      sellerPaid: 100_000,
      buyerRefund: 380_000,
      sellerRefund: 80_000,
      penaltyPerParty: 20_000,
      penaltyPercent: 20,
    });

    await service.autoCancelExpiredOrders();

    expect(
      walletMock.refundExchangeBothNoShipmentOnCancel,
    ).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId,
        buyerId,
        sellerId,
        listingId,
        verificationFee: 100_000,
        inspectionPenaltyPercent: expect.any(Number),
      }),
    );
    expect(walletMock.refundDirectOrderEscrowOnCancel).not.toHaveBeenCalled();

    expect(tx.user.update).toHaveBeenCalledTimes(2);
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: buyerId } }),
    );
    expect(tx.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: sellerId } }),
    );

    expect(stateMachineMock.assertTransition).toHaveBeenCalledWith(
      OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      OrderStatus.CANCELLED,
      'auto-cancel-expired',
    );

    expect(orderReputationMock.recordTerminalOutcome).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ id: orderId }),
      OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      'FAILURE',
      expect.objectContaining({
        failurePenalizeUserIds: [buyerId, sellerId],
      }),
    );

    expect(tx.ticket.create).toHaveBeenCalledTimes(2);
    const buyerTicketMessage =
      tx.ticket.create.mock.calls[0][0].data.messages.create.message;
    expect(buyerTicketMessage).toContain('جریمه کارشناسی');
    expect(buyerTicketMessage).toContain('۳۸۰٬۰۰۰');
    expect(buyerTicketMessage).not.toContain('۴۰۰٬۰۰۰ تومان، شامل هزینه کارشناسی) به کیف پولتان برگشت');
    expect(tx.notification.createMany).toHaveBeenCalled();
  });

  it('autoCancelExpiredOrders: direct sale timeout -> CANCELLED + escrow refund txns', async () => {
    const orderId = 'ord-direct-1';
    const listingId = 'lst-1';
    const expiredOrder = {
      id: orderId,
      type: OrderType.DIRECT,
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId,
      status: OrderStatus.PAID,
      trackingCode: null,
      sellerTrackingCode: null,
      sellerRevenue: 900_000,
      totalAmount: 1_000_000,
      verificationFee: 0,
      exchangeHubInspection: null,
      tradeReputationAt: null,
      listing: { title: 'گوشی آیفون' },
      shippingDeadline: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 86_400_000),
      createdAt: new Date(Date.now() - 86_400_000),
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      exchangeOffer: { findUnique: jest.fn() },
      wallet: { upsert: jest.fn() },
      walletTransaction: { create: jest.fn(), updateMany: jest.fn() },
      user: { update: jest.fn().mockResolvedValue({}) },
      order: {
        findUnique: jest.fn().mockResolvedValue({ status: OrderStatus.PAID }),
        update: jest.fn().mockResolvedValue({}),
      },
      ticket: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'ticket-buyer' })
          .mockResolvedValueOnce({ id: 'ticket-seller' }),
      },
      notification: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        create: jest.fn().mockResolvedValue({}),
      },
      listing: {
        update: jest
          .fn()
          .mockResolvedValue({ id: listingId, status: ListingStatus.REJECTED }),
      },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundDirectOrderEscrowOnCancel.mockResolvedValue(undefined);

    await service.autoCancelExpiredOrders();

    expect(listingCommandMock.rejectAfterTradeFailure).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        listingId,
        sellerId: 'seller-1',
        rejectionReason: expect.stringContaining('عدم ارسال فروشنده'),
        source: 'shipping-timeout',
        orderId,
      }),
    );

    expect(walletMock.refundDirectOrderEscrowOnCancel).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        orderId,
        listingId,
        refundReason: 'shipping-timeout-cancel',
        sellerRevenue: 900_000,
        totalAmount: 1_000_000,
      }),
    );

    expect(stateMachineMock.assertTransition).toHaveBeenCalledWith(
      OrderStatus.PAID,
      OrderStatus.CANCELLED,
      'auto-cancel-expired',
    );

    expect(orderReputationMock.recordTerminalOutcome).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        id: orderId,
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
      }),
      OrderStatus.PAID,
      'FAILURE',
      expect.objectContaining({ failurePenalizeUserIds: ['seller-1'] }),
    );

    expect(tx.order.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OrderStatus.CANCELLED,
          cancelReason: expect.stringContaining('عدم ارسال'),
        }),
      }),
    );

    expect(tx.ticket.create).toHaveBeenCalledTimes(2);
    expect(tx.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'buyer-1',
          subject: expect.stringContaining('عدم ارسال فروشنده'),
        }),
      }),
    );
    expect(tx.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'seller-1',
          subject: expect.stringContaining('عدم ارسال در مهلت'),
        }),
      }),
    );
    expect(tx.notification.createMany).toHaveBeenCalled();
  });

  it('autoConfirmOrders: includes SHIPPED_TO_BUYER in auto-confirm flow', async () => {
    const orderId = 'ord-auto-1';
    prismaMock.order.findMany.mockResolvedValue([
      {
        id: orderId,
        type: OrderType.EXCHANGE,
        status: OrderStatus.SHIPPED_TO_BUYER,
        buyerConfirmDeadline: new Date(Date.now() - 60_000),
        disputedAt: null,
        updatedAt: new Date(Date.now() - 86_400_000),
        createdAt: new Date(Date.now() - 86_400_000),
        buyerId: 'buyer-1',
        sellerId: 'seller-1',
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

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
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
        shippingDeadline: new Date(Date.now() + 86_400_000),
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
        shippingDeadline: new Date(Date.now() + 86_400_000),
        listing: { sellerRequiresVerification: false },
      });
      prismaMock.order.update = jest.fn();

      await expect(
        service.updateTrackingCode(
          'seller-1',
          'ord-1',
          '123456789012345678901234',
        ),
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
        shippingDeadline: new Date(Date.now() + 86_400_000),
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
        shippingDeadline: new Date(Date.now() + 86_400_000),
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

  describe('purgeCompletedOrderVideos', () => {
    it('clears video fields for completed orders past retention', async () => {
      prismaMock.systemSetting.findUnique = jest
        .fn()
        .mockResolvedValue({ value: '10' });
      prismaMock.order.findMany = jest.fn().mockResolvedValue([
        {
          id: 'ord-old',
          packagingVideo: 'pack.mp4',
          buyerPackagingVideo: null,
          unboxingVideo: null,
          sellerUnboxingVideo: null,
          returnPackagingVideo: null,
        },
      ]);
      prismaMock.order.update = jest.fn().mockResolvedValue({ id: 'ord-old' });

      await service.purgeCompletedOrderVideos();

      expect(prismaMock.order.findMany).toHaveBeenCalled();
      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-old' },
        data: {
          packagingVideo: null,
          buyerPackagingVideo: null,
          unboxingVideo: null,
          sellerUnboxingVideo: null,
          returnPackagingVideo: null,
        },
      });
    });
  });
});
