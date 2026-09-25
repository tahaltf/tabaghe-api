import { Test, TestingModule } from '@nestjs/testing';
import { OrderType } from '@prisma/client';
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

describe('OrdersCheckoutService coupon', () => {
  let service: OrdersCheckoutService;

  const couponsServiceMock = {
    validateForSingleOrder: jest.fn().mockResolvedValue({
      couponId: 'coupon-1',
      discountAmount: 10_000,
    }),
  };

  const prismaMock = {
    $transaction: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.$transaction.mockRejectedValue(new Error('stop-after-coupon'));

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: {} },
        { provide: FeeCalculatorService, useValue: {} },
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
        { provide: OrdersSettingsService, useValue: {} },
        { provide: CouponsService, useValue: couponsServiceMock },
      ],
    }).compile();

    service = module.get(OrdersCheckoutService);
  });

  it('validates coupon for DIRECT checkout before transaction', async () => {
    await expect(
      service.handleUniversalOrder('buyer-1', {
        orderType: OrderType.DIRECT,
        listingId: 'listing-1',
        couponCode: ' SAVE10 ',
        addressId: 'addr-1',
        paymentMethod: 'GATEWAY',
        quantity: 2,
      }),
    ).rejects.toThrow('stop-after-coupon');

    expect(couponsServiceMock.validateForSingleOrder).toHaveBeenCalledWith(
      'buyer-1',
      'SAVE10',
      'listing-1',
      2,
    );
  });

  it('skips coupon validation when skipPaymentInit is true', async () => {
    await expect(
      service.handleUniversalOrder('buyer-1', {
        orderType: OrderType.DIRECT,
        listingId: 'listing-1',
        couponCode: 'SAVE10',
        skipPaymentInit: true,
        addressId: 'addr-1',
        paymentMethod: 'GATEWAY',
        quantity: 1,
      }),
    ).rejects.toThrow('stop-after-coupon');

    expect(couponsServiceMock.validateForSingleOrder).not.toHaveBeenCalled();
  });
});
