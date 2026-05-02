import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { OrdersStateMachineService } from './orders-state-machine.service';
import { AppSettingsService } from '../../shared/settings/app-settings.service';
import { PaymentsService } from '../payments/payments.service';
import { NotificationService } from '../notification/notification.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const prismaMock = {
    order: { findMany: jest.fn() },
    $transaction: jest.fn(),
  };

  const walletMock = { releaseEscrow: jest.fn() };
  const feeMock = {};
  const appSettingsMock = { getApiUrl: jest.fn(), getPaymentGatewayConfig: jest.fn() };
  const paymentsMock = { initiateOrderPayment: jest.fn() };
  const notificationMock = { create: jest.fn() };
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
});
