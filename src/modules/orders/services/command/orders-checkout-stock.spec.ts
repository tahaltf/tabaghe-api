import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { OrderStatus, OrderType } from '@prisma/client';
import { PrismaService } from '../../../../infrastructure/prisma/prisma.service';
import { WalletService } from '../../../wallet/wallet.service';
import { FeeCalculatorService } from '../../../fees/fee-calculator.service';
import { VerificationFeeCalculatorService } from '../../../fees/verification-fee-calculator.service';
import { AppSettingsService } from '../../../../shared/settings/app-settings.service';
import { OrdersStateMachineService } from '../../orders-state-machine.service';
import { PaymentsService } from '../../../payments/payments.service';
import { NotificationService } from '../../../notification/notification.service';
import { ExchangeOrderNotifyService } from '../../../notification/exchange-order-notify.service';
import { OrderReputationService } from '../../order-reputation.service';
import { ExchangeService } from '../../../exchange/exchange.service';
import { QuotaService } from '../../../quota/quota.service';
import { ListingCommandService } from '../../../listing/services/listing-command.service';
import { OrdersSettingsService } from '../../orders-settings.service';
import { CouponsService } from '../../../coupons/coupons.service';
import { OrdersCheckoutService } from './orders-checkout.service';

describe('OrdersCheckoutService multi-stock', () => {
  let service: OrdersCheckoutService;

  const listingId = 'listing-1';
  const sellerId = 'seller-1';
  const buyerId = 'buyer-2';

  function buildListing(stockQuantity: number) {
    return {
      id: listingId,
      status: 'APPROVED',
      stockQuantity,
      singleItemSale: false,
      authorId: sellerId,
      categoryId: 'cat-1',
      shippingPayer: 'SELLER',
      sellerRequiresVerification: false,
      shippingCostOverride: null,
      direct: { price: 1_000_000, salePrice: null },
    };
  }

  function buildTxMock(stockQuantity: number) {
    const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
    const create = jest.fn().mockRejectedValue(new Error('passed-block-check'));

    const tx = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      listing: {
        findUnique: jest.fn().mockImplementation(({ select }: { select?: Record<string, unknown> }) => {
          if (select && 'type' in select && 'stockQuantity' in select) {
            return Promise.resolve({ type: 'DIRECT', stockQuantity });
          }
          return Promise.resolve(buildListing(stockQuantity));
        }),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'order-paid', status: OrderStatus.PAID, buyerId: 'buyer-other' },
        ]),
        deleteMany,
        create,
      },
      address: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      wallet: {
        findUnique: jest.fn().mockResolvedValue({ balanceAvailable: 0 }),
      },
    };

    return { tx, deleteMany, create };
  }

  const prismaMock = {
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: {} },
        {
          provide: FeeCalculatorService,
          useValue: { calculateFee: jest.fn().mockResolvedValue(0) },
        },
        {
          provide: VerificationFeeCalculatorService,
          useValue: { resolve: jest.fn().mockResolvedValue(250_000) },
        },
        { provide: AppSettingsService, useValue: {} },
        { provide: OrdersStateMachineService, useValue: {} },
        { provide: PaymentsService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: ExchangeOrderNotifyService, useValue: {} },
        { provide: OrderReputationService, useValue: {} },
        { provide: ExchangeService, useValue: {} },
        { provide: QuotaService, useValue: {} },
        { provide: ListingCommandService, useValue: {} },
        {
          provide: OrdersSettingsService,
          useValue: {
            parsePositiveIntSetting: (_value: unknown, fallback: number) => fallback,
          },
        },
        { provide: CouponsService, useValue: {} },
      ],
    }).compile();

    service = module.get(OrdersCheckoutService);
  });

  it('allows checkout when stock > 1 and a prior PAID order exists', async () => {
    const { tx, deleteMany } = buildTxMock(5);
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );

    await expect(
      service.handleUniversalOrder(buyerId, {
        orderType: OrderType.DIRECT,
        listingId,
        addressId: 'addr-1',
        paymentMethod: 'GATEWAY',
        quantity: 1,
        skipPaymentInit: true,
      }),
    ).rejects.toThrow('passed-block-check');

    expect(deleteMany).toHaveBeenCalled();
  });

  it('blocks checkout when stock is 1 and a prior PAID order exists', async () => {
    const { tx } = buildTxMock(1);
    prismaMock.$transaction.mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) =>
      cb(tx),
    );

    await expect(
      service.handleUniversalOrder(buyerId, {
        orderType: OrderType.DIRECT,
        listingId,
        addressId: 'addr-1',
        paymentMethod: 'GATEWAY',
        quantity: 1,
        skipPaymentInit: true,
      }),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.handleUniversalOrder(buyerId, {
        orderType: OrderType.DIRECT,
        listingId,
        addressId: 'addr-1',
        paymentMethod: 'GATEWAY',
        quantity: 1,
        skipPaymentInit: true,
      }),
    ).rejects.toThrow('این کالا در حال حاضر به فروش رسیده و در جریان است.');
  });
});
