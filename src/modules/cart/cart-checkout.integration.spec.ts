import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartCheckoutService } from './cart-checkout.service';
import { CartService } from './cart.service';
import { OrdersCheckoutService } from '../orders/services/command/orders-checkout.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';

describe('CartCheckoutService integration', () => {
  let service: CartCheckoutService;

  const prismaMock = {
    listing: { findMany: jest.fn() },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };

  const cartServiceMock = {
    requireCartItems: jest.fn(),
  };

  const couponsServiceMock = {
    validateForCart: jest.fn(),
  };

  const ordersCheckoutMock = {
    handleUniversalOrder: jest.fn(),
  };

  const paymentsServiceMock = {
    initiateCheckoutSessionPayment: jest.fn(),
  };

  const threeListings = [
    {
      id: 'l-1',
      categoryId: 'cat-1',
      shippingPayer: 'SELLER',
      shippingCostOverride: null,
      direct: { price: 100_000, salePrice: null },
    },
    {
      id: 'l-2',
      categoryId: 'cat-1',
      shippingPayer: 'SELLER',
      shippingCostOverride: null,
      direct: { price: 200_000, salePrice: null },
    },
    {
      id: 'l-3',
      categoryId: 'cat-1',
      shippingPayer: 'SELLER',
      shippingCostOverride: null,
      direct: { price: 300_000, salePrice: null },
    },
  ];

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CartService, useValue: cartServiceMock },
        { provide: OrdersCheckoutService, useValue: ordersCheckoutMock },
        { provide: CouponsService, useValue: couponsServiceMock },
        { provide: PaymentsService, useValue: paymentsServiceMock },
      ],
    }).compile();
    service = module.get(CartCheckoutService);

    cartServiceMock.requireCartItems.mockResolvedValue({
      cart: { sellerId: 'seller-1' },
      items: [
        { listingId: 'l-1', quantity: 1 },
        { listingId: 'l-2', quantity: 1 },
        { listingId: 'l-3', quantity: 1 },
      ],
    });
    prismaMock.listing.findMany.mockResolvedValue(threeListings);
    couponsServiceMock.validateForCart.mockResolvedValue({
      couponId: 'coupon-1',
      discountAmount: 60_000,
      eligibleSubtotal: 600_000,
    });
    ordersCheckoutMock.handleUniversalOrder
      .mockResolvedValueOnce({ id: 'o-1', totalAmount: 100_000 })
      .mockResolvedValueOnce({ id: 'o-2', totalAmount: 200_000 })
      .mockResolvedValueOnce({ id: 'o-3', totalAmount: 300_000 });
  });

  function mockTransaction(): void {
    const txMock = {
      order: { update: jest.fn(), updateMany: jest.fn() },
      checkoutSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
      coupon: { update: jest.fn() },
      couponRedemption: { create: jest.fn() },
      cart: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }),
        delete: jest.fn(),
      },
      cartItem: { deleteMany: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));
  }

  it('checkout with 3 items creates one session and clears cart', async () => {
    mockTransaction();
    paymentsServiceMock.initiateCheckoutSessionPayment.mockResolvedValue({
      paymentUrl: 'https://gateway.test/pay',
    });

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'GATEWAY',
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(ordersCheckoutMock.handleUniversalOrder).toHaveBeenCalledTimes(3);
    expect(result.sessionId).toBe('session-1');
    expect(result.orderIds).toEqual(['o-1', 'o-2', 'o-3']);
    expect(result.totalAmount).toBe(540_000);
    expect(result.discountAmount).toBe(60_000);
    expect(result.paymentUrl).toBe('https://gateway.test/pay');
    expect(paymentsServiceMock.initiateCheckoutSessionPayment).toHaveBeenCalledWith(
      'session-1',
      'buyer-1',
    );
  });

  it('wallet checkout does not initiate gateway payment', async () => {
    mockTransaction();

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      requiresVerification: false,
    });

    expect(result.sessionId).toBe('session-1');
    expect(result.paymentUrl).toBeNull();
    expect(paymentsServiceMock.initiateCheckoutSessionPayment).not.toHaveBeenCalled();
  });

  it('distributes coupon discount across 3 orders proportionally', async () => {
    const txMock = {
      order: { update: jest.fn(), updateMany: jest.fn() },
      checkoutSession: {
        create: jest.fn().mockResolvedValue({ id: 'session-1' }),
      },
      coupon: { update: jest.fn() },
      couponRedemption: { create: jest.fn() },
      cart: {
        findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }),
        delete: jest.fn(),
      },
      cartItem: { deleteMany: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

    await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { totalAmount: 90_000 },
    });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'o-2' },
      data: { totalAmount: 180_000 },
    });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'o-3' },
      data: { totalAmount: 270_000 },
    });
    expect(txMock.couponRedemption.create).toHaveBeenCalledWith({
      data: {
        couponId: 'coupon-1',
        userId: 'buyer-1',
        checkoutSessionId: 'session-1',
        amount: 60_000,
      },
    });
  });
});
