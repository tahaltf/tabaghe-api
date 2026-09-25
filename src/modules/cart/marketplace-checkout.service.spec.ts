import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutSessionSource, OrderType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrdersCheckoutService } from '../orders/services/command/orders-checkout.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { MarketplaceCheckoutService } from './marketplace-checkout.service';
import { VerificationFeeCalculatorService } from '../fees/verification-fee-calculator.service';

describe('MarketplaceCheckoutService', () => {
  let service: MarketplaceCheckoutService;

  const prismaMock: any = {
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
    order: {
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
    checkoutSession: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    listing: { findUnique: jest.fn() },
  };

  const ordersCheckoutMock = {
    handleUniversalOrder: jest.fn(),
  };

  const couponsServiceMock = {
    validateForCart: jest.fn(),
  };

  const paymentsServiceMock = {
    initiateCheckoutSessionPayment: jest.fn(),
    settleCheckoutSessionFromWallet: jest.fn(),
  };

  const verificationFeeCalculatorMock = {
    resolve: jest.fn().mockResolvedValue(250_000),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketplaceCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: OrdersCheckoutService, useValue: ordersCheckoutMock },
        { provide: CouponsService, useValue: couponsServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
        {
          provide: VerificationFeeCalculatorService,
          useValue: verificationFeeCalculatorMock,
        },
      ],
    }).compile();
    service = module.get(MarketplaceCheckoutService);
  });

  it('applyDiscountToOrderFinance takes discount from platform cut first', () => {
    const result = service.applyDiscountToOrderFinance({
      totalAmount: 1_000_000,
      platformFee: 50_000,
      sellerRevenue: 700_000,
      verificationFee: 250_000,
      discountShare: 100_000,
    });
    expect(result.totalAmount).toBe(900_000);
    expect(result.sellerRevenue).toBe(700_000);
    expect(result.platformFee).toBe(0);
  });

  it('checkoutLines defers settlement and applies verification fee once', async () => {
    couponsServiceMock.validateForCart.mockResolvedValue({
      couponId: null,
      discountAmount: 0,
    });
    prismaMock.systemSetting.findUnique.mockResolvedValue({ value: '250000' });
    verificationFeeCalculatorMock.resolve.mockResolvedValue(125_000);

    ordersCheckoutMock.handleUniversalOrder
      .mockResolvedValueOnce({
        id: 'o-1',
        totalAmount: 450_000,
        platformFee: 20_000,
        sellerRevenue: 180_000,
        verificationFee: 250_000,
      })
      .mockResolvedValueOnce({
        id: 'o-2',
        totalAmount: 200_000,
        platformFee: 10_000,
        sellerRevenue: 190_000,
        verificationFee: 0,
      });

    const txMock = {
      order: { update: jest.fn(), updateMany: jest.fn() },
      checkoutSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
      coupon: { update: jest.fn() },
      couponRedemption: { create: jest.fn() },
      cart: { findUnique: jest.fn(), delete: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
    prismaMock.order.findUnique.mockResolvedValue({
      id: 'o-1',
      status: 'AWAITING_PAYMENT',
    });
    paymentsServiceMock.initiateCheckoutSessionPayment.mockResolvedValue({
      paymentUrl: 'https://pay.test',
    });

    const result = await service.checkoutLines('buyer-1', {
      source: CheckoutSessionSource.CART,
      addressId: 'addr-1',
      paymentMethod: 'GATEWAY',
      requiresVerification: true,
      clearCart: false,
      items: [
        {
          listingId: 'l-1',
          quantity: 1,
          unitPrice: 200_000,
          lineTotal: 200_000,
          shippingCost: 0,
          categoryId: 'c1',
        },
        {
          listingId: 'l-2',
          quantity: 1,
          unitPrice: 200_000,
          lineTotal: 200_000,
          shippingCost: 0,
          categoryId: 'c1',
        },
      ],
    });

    expect(ordersCheckoutMock.handleUniversalOrder).toHaveBeenNthCalledWith(
      1,
      'buyer-1',
      expect.objectContaining({
        deferSettlement: true,
        verificationFeeOverride: 250_000,
        orderType: OrderType.DIRECT,
      }),
    );
    expect(ordersCheckoutMock.handleUniversalOrder).toHaveBeenNthCalledWith(
      2,
      'buyer-1',
      expect.objectContaining({
        deferSettlement: true,
        verificationFeeOverride: 0,
      }),
    );
    expect(txMock.checkoutSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        source: CheckoutSessionSource.CART,
        totalAmount: 650_000,
      }),
    });
    expect(paymentsServiceMock.initiateCheckoutSessionPayment).toHaveBeenCalled();
    expect(result.paymentUrl).toBe('https://pay.test');
    expect(result.sessionId).toBe('session-1');
  });

  it('DIRECT wallet checkout settles via wallet without gateway', async () => {
    couponsServiceMock.validateForCart.mockResolvedValue({
      couponId: null,
      discountAmount: 0,
    });
    ordersCheckoutMock.handleUniversalOrder.mockResolvedValue({
      id: 'o-1',
      totalAmount: 100_000,
      platformFee: 5_000,
      sellerRevenue: 95_000,
      verificationFee: 0,
    });
    const txMock = {
      order: { update: jest.fn(), updateMany: jest.fn() },
      checkoutSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-d' }),
      },
      coupon: { update: jest.fn() },
      couponRedemption: { create: jest.fn() },
      cart: { findUnique: jest.fn(), delete: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn: any) => fn(txMock));
    prismaMock.order.findUnique.mockResolvedValue({ id: 'o-1' });
    paymentsServiceMock.settleCheckoutSessionFromWallet.mockResolvedValue({
      ok: true,
    });

    const result = await service.checkoutLines('buyer-1', {
      source: CheckoutSessionSource.DIRECT,
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      clearCart: false,
      items: [
        {
          listingId: 'l-1',
          quantity: 1,
          unitPrice: 100_000,
          lineTotal: 100_000,
          shippingCost: 0,
          categoryId: 'c1',
        },
      ],
    });

    expect(txMock.checkoutSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source: CheckoutSessionSource.DIRECT }),
    });
    expect(
      paymentsServiceMock.settleCheckoutSessionFromWallet,
    ).toHaveBeenCalledWith('session-d', 'buyer-1', undefined);
    expect(
      paymentsServiceMock.initiateCheckoutSessionPayment,
    ).not.toHaveBeenCalled();
    expect(result.paymentUrl).toBeNull();
  });
});
