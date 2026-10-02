import { Test, TestingModule } from '@nestjs/testing';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersEarlyEscrowService } from './services/command/orders-early-escrow.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';
import { OrdersUnpaidCancelService } from './services/command/orders-unpaid-cancel.service';
import { ReferralRewardService } from '../referral/referral-reward.service';
import { OrdersSchedulerService } from './services/scheduler/orders-scheduler.service';
import { OrdersSettingsService } from './orders-settings.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { VerificationFeeCalculatorService } from '../fees/verification-fee-calculator.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from '../notification/notification.service';
import { OrderReputationService } from './order-reputation.service';
import { ExchangeService } from '../exchange/exchange.service';
import { QuotaService } from '../quota/quota.service';
import { ListingCommandService } from '../listing/services/listing-command.service';
import { OrdersResponseEnrichmentService } from './services/query/orders-response-enrichment.service';
import { ExchangeOrderNotifyService } from '../notification/exchange-order-notify.service';
import { OperationalNotifyService } from '../notification/operational-notify.service';
import { CouponsService } from '../coupons/coupons.service';
import { CurrencyService } from '../currency/currency.service';
import {
  ListingStatus,
  OrderStatus,
  OrderType,
  WalletTransactionStatus,
  WalletTransactionType,
} from '@prisma/client';

describe('Orders domain services', () => {
  let checkout: OrdersCheckoutService;
  let shipping: OrdersShippingService;
  let completion: OrdersCompletionService;
  let scheduler: OrdersSchedulerService;

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
    getOrderScopedBlockedAmount: jest.fn().mockResolvedValue(0),
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
  const notificationMock = {
    create: jest.fn(),
    notifyUserTickets: jest.fn().mockResolvedValue(undefined),
  };
  const operationalNotifyMock = {
    notifyOrderCompleted: jest.fn().mockResolvedValue(undefined),
    notifyDirectShipmentRegistered: jest.fn().mockResolvedValue(undefined),
    notifyExchangeBothNoShipmentCancel: jest.fn().mockResolvedValue(undefined),
    notifyExchangeOneSideNoShipmentCancel: jest.fn().mockResolvedValue(undefined),
  };
  const earlyEscrowMock = {
    tryTrustedShipmentRelease: jest.fn().mockResolvedValue(0),
    tryHubVerifiedRelease: jest.fn().mockResolvedValue(0),
    markReleasedIfNeeded: jest.fn(),
  };
  const exchangeOrderNotifyMock = {
    notifyCheckoutProgress: jest.fn(),
    afterShipmentUpdated: jest.fn(),
  };
  const orderReputationMock = { recordTerminalOutcome: jest.fn() };
  const exchangeMock = { rejectNonWinningExchangeOffersAfterSale: jest.fn() };
  const quotaMock = { releaseOnReject: jest.fn().mockResolvedValue(undefined) };
  const listingCommandMock = {
    rejectAfterTradeFailure: jest.fn().mockResolvedValue(undefined),
  };
  const enrichmentMock = {
    computeBuyerConfirmDeadlineNow: jest.fn(),
    ensureBuyerConfirmDeadline: jest.fn(),
    isBuyerConfirmDeadlineExpired: jest.fn(),
    attachBuyerConfirmDeadline: jest.fn((o) => o),
    enrichOrderClientFields: jest.fn((o) => o),
  };
  const stateMachineMock = {
    canTransition: jest.fn(),
    assertTransition: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersCheckoutService,
        OrdersShippingService,
        {
          provide: OrdersEarlyEscrowService,
          useValue: earlyEscrowMock,
        },
        OrdersCompletionService,
        OrdersSchedulerService,
        OrdersSettingsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        { provide: FeeCalculatorService, useValue: feeMock },
        {
          provide: VerificationFeeCalculatorService,
          useValue: { resolve: jest.fn().mockResolvedValue(250_000) },
        },
        { provide: AppSettingsService, useValue: appSettingsMock },
        { provide: OrdersStateMachineService, useValue: stateMachineMock },
        { provide: PaymentsService, useValue: paymentsMock },
        { provide: NotificationService, useValue: notificationMock },
        {
          provide: OperationalNotifyService,
          useValue: operationalNotifyMock,
        },
        {
          provide: ExchangeOrderNotifyService,
          useValue: exchangeOrderNotifyMock,
        },
        { provide: OrderReputationService, useValue: orderReputationMock },
        { provide: ExchangeService, useValue: exchangeMock },
        { provide: QuotaService, useValue: quotaMock },
        { provide: ListingCommandService, useValue: listingCommandMock },
        {
          provide: OrdersResponseEnrichmentService,
          useValue: enrichmentMock,
        },
        { provide: CouponsService, useValue: {} },
        {
          provide: CurrencyService,
          useValue: {
            getEffectiveRate: jest.fn().mockResolvedValue(1),
            applyRate: jest.fn((amount: number) => amount),
          },
        },
        {
          provide: ReferralRewardService,
          useValue: { creditForCompletedOrder: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: OrdersUnpaidCancelService,
          useValue: { cancelUnpaidOrder: jest.fn(), isOrderUnpaid: jest.fn() },
        },
      ],
    }).compile();

    checkout = module.get(OrdersCheckoutService);
    shipping = module.get(OrdersShippingService);
    completion = module.get(OrdersCompletionService);
    scheduler = module.get(OrdersSchedulerService);
  });

  it('should be defined', () => {
    expect(checkout).toBeDefined();
    expect(scheduler).toBeDefined();
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
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'old-order',
            type: OrderType.EXCHANGE,
            status: OrderStatus.CANCELLED,
            exchangeOfferId: null,
            totalAmount: 0,
          })
          .mockResolvedValue(null),
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

    const result = await checkout.handleUniversalOrder(buyerId, {
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

  it('handleUniversalOrder EXCHANGE: removes stale order from WAITLISTED offer on same listing', async () => {
    const offerId = 'offer-new';
    const oldOfferId = 'offer-old';
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
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) => {
            if (where.id === offerId) {
              return Promise.resolve({
                id: offerId,
                status: 'ACCEPTED',
                listingId,
                offererId: buyerId,
                isPayerMe: false,
                extraPayment: 0,
                listing: { authorId: sellerId, categoryId: 'cat-1', direct: null },
              });
            }
            if (where.id === oldOfferId) {
              return Promise.resolve({ status: 'WAITLISTED' });
            }
            return Promise.resolve(null);
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
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce({
            id: 'old-order',
            type: OrderType.EXCHANGE,
            status: OrderStatus.AWAITING_PAYMENT,
            exchangeOfferId: oldOfferId,
            totalAmount: 250000,
          })
          .mockResolvedValue(null),
        findUnique: jest
          .fn()
          .mockResolvedValueOnce({
            id: 'old-order',
            type: OrderType.EXCHANGE,
            status: OrderStatus.AWAITING_PAYMENT,
            exchangeOfferId: oldOfferId,
            totalAmount: 250000,
          })
          .mockResolvedValue(null),
        delete: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({
          id: 'ord-new',
          type: OrderType.EXCHANGE,
          status: OrderStatus.AWAITING_PAYMENT,
          totalAmount: 0,
          verificationFee: 250000,
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

    await checkout.handleUniversalOrder(buyerId, {
      orderType: 'EXCHANGE',
      paymentMethod: 'WALLET',
      exchangeOfferId: offerId,
      listingId,
      addressId: 'addr-1',
      requiresVerification: true,
    });

    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'old-order' } });
    expect(tx.order.create).toHaveBeenCalled();
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
    walletMock.getOrderScopedBlockedAmount.mockImplementation(
      async (_tx, params: { userId: string }) =>
        params.userId === 'buyer-1' ? 500 : 0,
    );
    prismaMock.order.findUnique.mockResolvedValue({
      status: 'SHIPPED_TO_BUYER',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      type: 'EXCHANGE',
    });

    await completion.confirmOrder('buyer-1', 'ord-1');

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
      listing: { title: 'کالا' },
    };

    prismaMock.order.findMany.mockResolvedValue([expiredOrder]);

    const tx = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
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
      ticket: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'ticket-sender' })
          .mockResolvedValueOnce({ id: 'ticket-offender' }),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundExchangeOneSideNoShipmentOnCancel.mockResolvedValue({
      senderRefund: 100,
      offenderRefund: 0,
      compensation: 20,
    });

    await scheduler.autoCancelExpiredOrders();

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
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
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
      ticket: {
        create: jest
          .fn()
          .mockResolvedValueOnce({ id: 'ticket-sender' })
          .mockResolvedValueOnce({ id: 'ticket-offender' }),
      },
      notification: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };

    prismaMock.$transaction.mockImplementation(
      async (cb: (trx: typeof tx) => Promise<unknown>) => cb(tx),
    );

    walletMock.refundExchangeOneSideNoShipmentOnCancel.mockResolvedValue({
      senderRefund: 200,
      offenderRefund: 80,
      compensation: 20,
    });

    await scheduler.autoCancelExpiredOrders();

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
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
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
      buyerRefund: 400_000,
      sellerRefund: 100_000,
      penaltyPerParty: 0,
      penaltyPercent: 0,
    });

    await scheduler.autoCancelExpiredOrders();

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
        inspectionPenaltyPercent: 0,
      }),
    );
    expect(walletMock.refundDirectOrderEscrowOnCancel).not.toHaveBeenCalled();

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
    expect(buyerTicketMessage).not.toContain('جریمه کارشناسی');
    expect(buyerTicketMessage).toContain('۴۰۰٬۰۰۰');
    expect(buyerTicketMessage).not.toContain('۴۰۰٬۰۰۰ تومان، شامل هزینه کارشناسی) به کیف پولتان برگشت');
    expect(operationalNotifyMock.notifyExchangeBothNoShipmentCancel).toHaveBeenCalled();
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
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
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

    await scheduler.autoCancelExpiredOrders();

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
    expect(notificationMock.notifyUserTickets).toHaveBeenCalled();
  });

  it('autoConfirmOrders: exchange auto-confirms only shipped legs (not whole deal)', async () => {
    const orderId = 'ord-auto-1';
    const past = new Date(Date.now() - 60_000).toISOString();
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
        hubToBuyerTrackingCode: 'B-TRACK',
        hubToSellerTrackingCode: null,
        buyerConfirmedDelivery: false,
        sellerConfirmedDelivery: false,
        exchangeHubInspection: { buyerLegConfirmDeadline: past },
      },
    ]);

    const confirmSpy = jest
      .spyOn(completion, 'confirmOrder')
      .mockResolvedValue({ id: orderId } as never);

    await scheduler.autoConfirmOrders();

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy).toHaveBeenCalledWith('buyer-1', orderId);
    expect(walletMock.releaseEscrow).not.toHaveBeenCalled();
    expect(orderReputationMock.recordTerminalOutcome).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
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
        shipping.updateTrackingCode('seller-1', 'ord-1', '123', 'video.mp4'),
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
        shipping.updateTrackingCode(
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
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn({}));

      await shipping.updateTrackingCode(
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
      expect(earlyEscrowMock.tryTrustedShipmentRelease).toHaveBeenCalled();
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
      prismaMock.$transaction.mockImplementation(async (fn: any) => fn({}));

      await shipping.updateTrackingCode(
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
      expect(earlyEscrowMock.tryTrustedShipmentRelease).toHaveBeenCalled();
    });

    it('ارسال به هاب حتی برای فروشنده مورد اعتماد آزادسازی ندارد', async () => {
      prismaMock.order.findUnique = jest.fn().mockResolvedValue({
        id: 'ord-hub',
        type: OrderType.DIRECT,
        status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
        sellerId: 'seller-1',
        buyerId: 'buyer-1',
        listingId: 'lst-hub',
        trackingCode: null,
        sellerTrackingCode: null,
        requiresVerification: true,
        shippingDeadline: new Date(Date.now() + 86_400_000),
        listing: { sellerRequiresVerification: true },
      });
      prismaMock.order.update = jest.fn().mockResolvedValue({
        id: 'ord-hub',
        status: OrderStatus.SHIPPED_TO_HUB,
      });
      prismaMock.$transaction.mockClear();

      await shipping.updateTrackingCode(
        'seller-1',
        'ord-hub',
        '123456789012345678901234',
        'video-hub.mp4',
      );

      expect(prismaMock.order.update).toHaveBeenCalledWith({
        where: { id: 'ord-hub' },
        data: expect.objectContaining({
          status: OrderStatus.SHIPPED_TO_HUB,
        }),
      });
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
      expect(earlyEscrowMock.tryTrustedShipmentRelease).not.toHaveBeenCalled();
      expect(walletMock.releaseEscrow).not.toHaveBeenCalled();
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

      await scheduler.purgeCompletedOrderVideos();

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
