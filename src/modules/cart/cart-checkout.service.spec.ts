import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutSessionSource } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartCheckoutService } from './cart-checkout.service';
import { CartService } from './cart.service';
import { MarketplaceCheckoutService } from './marketplace-checkout.service';

describe('CartCheckoutService', () => {
  let service: CartCheckoutService;

  const prismaMock = {
    listing: { findMany: jest.fn() },
    systemSetting: { findUnique: jest.fn().mockResolvedValue(null) },
  };

  const cartServiceMock = {
    requireCartItems: jest.fn(),
  };

  const marketplaceMock = {
    previewFromLines: jest.fn(),
    checkoutLines: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartCheckoutService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CartService, useValue: cartServiceMock },
        { provide: MarketplaceCheckoutService, useValue: marketplaceMock },
      ],
    }).compile();
    service = module.get(CartCheckoutService);
  });

  it('preview applies coupon discount and shipping via marketplace', async () => {
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
    marketplaceMock.previewFromLines.mockResolvedValue({
      items: [],
      subtotal: 1_000_000,
      shippingTotal: 0,
      verificationFee: 0,
      discountAmount: 100_000,
      couponId: 'coupon-1',
      totalPayable: 900_000,
    });

    const preview = await service.preview('buyer-1', {
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(preview.subtotal).toBe(1_000_000);
    expect(preview.discountAmount).toBe(100_000);
    expect(preview.totalPayable).toBe(900_000);
    expect(preview.couponId).toBe('coupon-1');
    expect(preview.sellerId).toBe('seller-1');
  });

  it('checkout delegates to marketplace with CART source and clearCart', async () => {
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
    marketplaceMock.checkoutLines.mockResolvedValue({
      sessionId: 'session-1',
      orderIds: ['o-1', 'o-2'],
      totalAmount: 900_000,
      discountAmount: 100_000,
      paymentUrl: null,
    });

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(marketplaceMock.checkoutLines).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({
        source: CheckoutSessionSource.CART,
        clearCart: true,
        paymentMethod: 'WALLET',
        addressId: 'addr-1',
      }),
    );
    expect(result.sessionId).toBe('session-1');
    expect(result.orderIds).toEqual(['o-1', 'o-2']);
  });
});
