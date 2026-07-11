import { Test, TestingModule } from '@nestjs/testing';
import { WalletTransactionStatus, WalletTransactionType } from '@prisma/client';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { ZibalGateway } from './gateways/zibal.gateway';
import { NotificationService } from '../notification/notification.service';
import { ExchangeService } from '../exchange/exchange.service';
import { ExchangeOrderNotifyService } from '../notification/exchange-order-notify.service';

describe('PaymentsService', () => {
  let service: PaymentsService;

  const prismaMock: any = {
    walletTransaction: {
      findFirst: jest.fn(),
      update: jest.fn(),
      findUnique: jest.fn(),
    },
    wallet: {
      update: jest.fn(),
    },
    checkoutSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const walletServiceMock = {
    getWalletByUserId: jest.fn(),
    creditExternalPaymentToEscrow: jest.fn(),
    linkEscrowDepositsToOrder: jest.fn(),
    transferToEscrow: jest.fn(),
  };

  const appSettingsMock = {
    getActivePaymentGateway: jest.fn().mockReturnValue('zibal'),
    getPaymentGatewayConfig: jest.fn(),
  };

  const zibalGatewayMock = {
    name: 'zibal',
    requestPayment: jest.fn(),
    verifyPayment: jest.fn(),
  };

  const notificationMock = {
    create: jest.fn(),
    createMany: jest.fn(),
    createUserOperational: jest.fn().mockResolvedValue(undefined),
    notifyAdminNewOrder: jest.fn().mockResolvedValue(undefined),
  };
  const exchangeMock = { rejectNonWinningExchangeOffersAfterSale: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletServiceMock },
        { provide: AppSettingsService, useValue: appSettingsMock },
        { provide: ZibalGateway, useValue: zibalGatewayMock },
        { provide: NotificationService, useValue: notificationMock },
        { provide: ExchangeService, useValue: exchangeMock },
        { provide: ExchangeOrderNotifyService, useValue: {} },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  it('processes wallet callback when success=1 even with status=2', async () => {
    prismaMock.walletTransaction.findFirst.mockResolvedValueOnce({
      id: 'tx-1',
      walletId: 'w1',
      amount: 50000,
      status: WalletTransactionStatus.PENDING,
      type: WalletTransactionType.DEPOSIT,
      meta: { kind: 'gateway-topup', authority: 'A1' },
    });
    zibalGatewayMock.verifyPayment.mockResolvedValue({
      success: true,
      refId: 'REF-1',
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        walletTransaction: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'tx-1',
            walletId: 'w1',
            amount: 50000,
            status: WalletTransactionStatus.PENDING,
            meta: { kind: 'gateway-topup', authority: 'A1' },
          }),
          update: prismaMock.walletTransaction.update,
        },
        wallet: {
          update: prismaMock.wallet.update,
          findUnique: jest.fn().mockResolvedValue({ userId: 'user-1' }),
        },
      }),
    );

    const result = await service.processGatewayCallback('zibal', {
      kind: 'WALLET',
      success: '1',
      status: '2',
      trackId: 'A1',
    });

    expect(zibalGatewayMock.verifyPayment).toHaveBeenCalledTimes(1);
    expect(prismaMock.wallet.update).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, result: 'PAID', kind: 'WALLET' });
  });

  it('marks wallet topup as failed when success flag is not successful', async () => {
    prismaMock.walletTransaction.findFirst.mockResolvedValueOnce({
      id: 'tx-2',
      walletId: 'w2',
      amount: 10000,
      status: WalletTransactionStatus.PENDING,
      type: WalletTransactionType.DEPOSIT,
      meta: { kind: 'gateway-topup', authority: 'A2' },
    });
    prismaMock.walletTransaction.update.mockResolvedValue({});

    const result = await service.processGatewayCallback('zibal', {
      kind: 'WALLET',
      success: '0',
      trackId: 'A2',
    });

    expect(result).toMatchObject({ ok: false, result: 'CANCELLED_BY_USER' });
    expect(prismaMock.walletTransaction.update).toHaveBeenCalledTimes(1);
    expect(zibalGatewayMock.verifyPayment).not.toHaveBeenCalled();
  });

  it('accepts authority param fallback in callback query', async () => {
    prismaMock.walletTransaction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'tx-3',
        status: WalletTransactionStatus.SUCCESS,
        type: WalletTransactionType.DEPOSIT,
        meta: { kind: 'gateway-topup', authority: 'AUTH-3' },
      });

    const result = await service.processGatewayCallback('zibal', {
      kind: 'WALLET',
      success: 'true',
      authority: 'AUTH-3',
    });

    expect(result).toMatchObject({ ok: true, result: 'ALREADY_PROCESSED' });
  });

  it('cancels checkout session when user aborts gateway payment', async () => {
    prismaMock.checkoutSession.findUnique.mockResolvedValue({
      id: 'session-1',
      status: 'PENDING',
      totalAmount: 540_000,
      orders: [{ id: 'o-1', status: 'PENDING' }],
    });
    prismaMock.checkoutSession.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o-1',
            status: 'PENDING',
            type: 'DIRECT',
            totalAmount: 100_000,
          }),
          delete: jest.fn(),
        },
        secondChanceOffer: { updateMany: jest.fn() },
      }),
    );

    const result = await service.processGatewayCallback('zibal', {
      kind: 'CHECKOUT_SESSION',
      sessionId: 'session-1',
      orderId: 'session-1',
      success: '0',
      trackId: 'AUTH-CART-1',
    });

    expect(result).toMatchObject({
      ok: false,
      result: 'CANCELLED_BY_USER',
      kind: 'CHECKOUT_SESSION',
      sessionId: 'session-1',
    });
    expect(prismaMock.checkoutSession.update).toHaveBeenCalledWith({
      where: { id: 'session-1' },
      data: { status: 'CANCELLED' },
    });
    expect(zibalGatewayMock.verifyPayment).not.toHaveBeenCalled();
  });

  it('rolls back checkout session when gateway verify fails', async () => {
    prismaMock.checkoutSession.findUnique.mockResolvedValue({
      id: 'session-2',
      status: 'PENDING',
      totalAmount: 300_000,
      orders: [{ id: 'o-2', status: 'AWAITING_PAYMENT' }],
    });
    prismaMock.checkoutSession.update.mockResolvedValue({});
    zibalGatewayMock.verifyPayment.mockResolvedValue({
      success: false,
      message: 'not paid',
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o-2',
            status: 'AWAITING_PAYMENT',
            type: 'DIRECT',
            totalAmount: 300_000,
          }),
          delete: jest.fn(),
        },
        secondChanceOffer: { updateMany: jest.fn() },
      }),
    );

    const result = await service.processGatewayCallback('zibal', {
      kind: 'CHECKOUT_SESSION',
      sessionId: 'session-2',
      orderId: 'session-2',
      success: '1',
      trackId: 'AUTH-CART-2',
    });

    expect(result).toMatchObject({
      ok: false,
      result: 'NOT_PAID',
      kind: 'CHECKOUT_SESSION',
    });
    expect(prismaMock.checkoutSession.update).toHaveBeenCalledWith({
      where: { id: 'session-2' },
      data: { status: 'CANCELLED' },
    });
  });

  it('credits gateway escrow (not wallet debit) when checkout session pays', async () => {
    const orderUpdate = jest.fn();
    const listingUpdate = jest.fn();
    const walletUpsert = jest.fn().mockResolvedValue({ id: 'w-buyer' });
    const walletTxCreate = jest.fn();
    const sessionWithOrders = {
      id: 'session-3',
      status: 'PENDING',
      totalAmount: 500_000,
      orders: [{ id: 'o-3', status: 'AWAITING_PAYMENT' }],
    };

    prismaMock.checkoutSession.findUnique
      .mockResolvedValueOnce(sessionWithOrders)
      .mockResolvedValueOnce({
        ...sessionWithOrders,
        status: 'PAID',
        orders: [
          {
            id: 'o-3',
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            listingId: 'listing-1',
            status: 'PAID',
          },
        ],
      });
    zibalGatewayMock.verifyPayment.mockResolvedValue({
      success: true,
      refId: 'REF-CART',
    });
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        checkoutSession: {
          findUnique: jest.fn().mockResolvedValue(sessionWithOrders),
          update: prismaMock.checkoutSession.update,
        },
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o-3',
            status: 'AWAITING_PAYMENT',
            type: 'DIRECT',
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            listingId: 'listing-1',
            totalAmount: 500_000,
            sellerRevenue: 450_000,
            requiresVerification: false,
            quantity: 1,
          }),
          update: orderUpdate,
        },
        listing: {
          findUnique: jest.fn().mockResolvedValue({
            title: 'کالای تست',
            stockQuantity: 2,
          }),
          update: listingUpdate,
        },
        wallet: { upsert: walletUpsert },
        walletTransaction: { create: walletTxCreate },
        systemSetting: {
          findFirst: jest.fn().mockResolvedValue({ value: '4320' }),
        },
      }),
    );
    prismaMock.checkoutSession.update.mockResolvedValue({});
    prismaMock.listing = {
      findUnique: jest.fn().mockResolvedValue({ title: 'کالای تست' }),
    };
    prismaMock.order.findUnique.mockResolvedValue({
      totalAmount: 500_000,
      finalPrice: 500_000,
    });
    walletServiceMock.creditExternalPaymentToEscrow.mockResolvedValue(undefined);
    walletServiceMock.linkEscrowDepositsToOrder.mockResolvedValue(undefined);
    notificationMock.create.mockResolvedValue(undefined);
    notificationMock.notifyAdminNewOrder = jest.fn().mockResolvedValue(undefined);

    const result = await service.processGatewayCallback('zibal', {
      kind: 'CHECKOUT_SESSION',
      sessionId: 'session-3',
      orderId: 'session-3',
      success: '1',
      trackId: 'AUTH-CART-3',
    });

    expect(result).toMatchObject({
      ok: true,
      result: 'PAID',
      kind: 'CHECKOUT_SESSION',
      sessionId: 'session-3',
    });
    expect(walletServiceMock.transferToEscrow).not.toHaveBeenCalled();
    expect(walletServiceMock.creditExternalPaymentToEscrow).toHaveBeenCalledWith(
      'seller-1',
      500_000,
      50_000,
      'listing-1',
      expect.anything(),
      { orderId: 'o-3' },
    );
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: 'o-3' },
      data: expect.objectContaining({ status: 'PAID' }),
    });
  });

  it('settleCheckoutSessionFromWallet uses transferToEscrow', async () => {
    const orderUpdate = jest.fn();
    const sessionWithOrders = {
      id: 'session-w',
      status: 'PENDING',
      buyerId: 'buyer-1',
      totalAmount: 200_000,
      orders: [{ id: 'o-w', status: 'AWAITING_PAYMENT' }],
    };
    prismaMock.checkoutSession.findUnique
      .mockResolvedValueOnce(sessionWithOrders)
      .mockResolvedValueOnce({
        ...sessionWithOrders,
        status: 'PAID',
        orders: [
          {
            id: 'o-w',
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            listingId: 'listing-1',
            status: 'PAID',
          },
        ],
      });
    prismaMock.wallet = {
      findUnique: jest.fn().mockResolvedValue({ balanceAvailable: 500_000 }),
    };
    prismaMock.$transaction.mockImplementation(async (cb: any) =>
      cb({
        checkoutSession: {
          findUnique: jest.fn().mockResolvedValue(sessionWithOrders),
          update: jest.fn(),
        },
        order: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'o-w',
            status: 'AWAITING_PAYMENT',
            buyerId: 'buyer-1',
            sellerId: 'seller-1',
            listingId: 'listing-1',
            totalAmount: 200_000,
            sellerRevenue: 180_000,
            requiresVerification: false,
            quantity: 1,
          }),
          update: orderUpdate,
        },
        listing: {
          findUnique: jest.fn().mockResolvedValue({
            title: 'تست',
            stockQuantity: 1,
          }),
          update: jest.fn(),
        },
        systemSetting: {
          findFirst: jest.fn().mockResolvedValue({ value: '4320' }),
        },
      }),
    );
    prismaMock.listing = {
      findUnique: jest.fn().mockResolvedValue({ title: 'تست' }),
    };
    prismaMock.order.findUnique.mockResolvedValue({
      totalAmount: 200_000,
      finalPrice: 200_000,
    });
    walletServiceMock.transferToEscrow.mockResolvedValue(undefined);
    walletServiceMock.linkEscrowDepositsToOrder.mockResolvedValue(undefined);
    notificationMock.create.mockResolvedValue(undefined);
    notificationMock.notifyAdminNewOrder = jest.fn().mockResolvedValue(undefined);

    const result = await service.settleCheckoutSessionFromWallet(
      'session-w',
      'buyer-1',
    );

    expect(result).toMatchObject({ ok: true, result: 'PAID' });
    expect(walletServiceMock.transferToEscrow).toHaveBeenCalledWith(
      'buyer-1',
      'seller-1',
      200_000,
      20_000,
      'listing-1',
      expect.anything(),
      { orderId: 'o-w' },
    );
    expect(walletServiceMock.creditExternalPaymentToEscrow).not.toHaveBeenCalled();
  });
});
