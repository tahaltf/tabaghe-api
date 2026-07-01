import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartCheckoutService } from './cart-checkout.service';
import { CartService } from './cart.service';
import { OrdersCheckoutService } from '../orders/services/command/orders-checkout.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';

describe('CartCheckoutService', () => {
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
  });

  it('preview applies coupon discount and shipping', async () => {
    cartServiceMock.requireCartItems.mockResolvedValue({
      cart: { sellerId: 'seller-1' },
      items: [{ listingId: 'l-1', quantity: 1 }],
    });
    prismaMock.listing.findMany.mockResolvedValue([
      {
        id: 'l-1',
        categoryId: 'cat-1',
        shippingPayer: 'SELLER',
        shippingCostOverride: null,
        direct: { price: 1_000_000, salePrice: null },
      },
    ]);
    couponsServiceMock.validateForCart.mockResolvedValue({
      couponId: 'coupon-1',
      discountAmount: 100_000,
      eligibleSubtotal: 1_000_000,
    });

    const preview = await service.preview('buyer-1', {
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(preview.subtotal).toBe(1_000_000);
    expect(preview.discountAmount).toBe(100_000);
    expect(preview.totalPayable).toBe(900_000);
    expect(preview.couponId).toBe('coupon-1');
  });

  it('distributes discount proportionally across orders on checkout', async () => {
    cartServiceMock.requireCartItems.mockResolvedValue({
      cart: { sellerId: 'seller-1' },
      items: [
        { listingId: 'l-1', quantity: 1 },
        { listingId: 'l-2', quantity: 1 },
      ],
    });
    prismaMock.listing.findMany.mockResolvedValue([
      {
        id: 'l-1',
        categoryId: 'cat-1',
        shippingPayer: 'SELLER',
        shippingCostOverride: null,
        direct: { price: 300_000, salePrice: null },
      },
      {
        id: 'l-2',
        categoryId: 'cat-1',
        shippingPayer: 'SELLER',
        shippingCostOverride: null,
        direct: { price: 700_000, salePrice: null },
      },
    ]);
    couponsServiceMock.validateForCart.mockResolvedValue({
      couponId: 'coupon-1',
      discountAmount: 100_000,
      eligibleSubtotal: 1_000_000,
    });

    ordersCheckoutMock.handleUniversalOrder
      .mockResolvedValueOnce({ id: 'o-1', totalAmount: 300_000 })
      .mockResolvedValueOnce({ id: 'o-2', totalAmount: 700_000 });

    const txMock = {
      order: { update: jest.fn(), updateMany: jest.fn() },
      checkoutSession: { create: jest.fn().mockResolvedValue({ id: 'session-1' }) },
      coupon: { update: jest.fn() },
      couponRedemption: { create: jest.fn() },
      cart: { findUnique: jest.fn().mockResolvedValue({ id: 'cart-1' }), delete: jest.fn() },
      cartItem: { deleteMany: jest.fn() },
    };
    prismaMock.$transaction.mockImplementation(async (fn) => fn(txMock));

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(result.sessionId).toBe('session-1');
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'o-1' },
      data: { totalAmount: 270_000 },
    });
    expect(txMock.order.update).toHaveBeenCalledWith({
      where: { id: 'o-2' },
      data: { totalAmount: 630_000 },
    });
  });
});
