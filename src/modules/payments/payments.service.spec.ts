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
    $transaction: jest.fn(),
  };

  const walletServiceMock = {
    getWalletByUserId: jest.fn(),
    creditExternalPaymentToEscrow: jest.fn(),
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

  const notificationMock = { create: jest.fn(), createMany: jest.fn() };
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
});
