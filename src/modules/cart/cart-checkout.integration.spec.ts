import { Test, TestingModule } from '@nestjs/testing';
import { CheckoutSessionSource } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartCheckoutService } from './cart-checkout.service';
import { CartService } from './cart.service';
import { MarketplaceCheckoutService } from './marketplace-checkout.service';

describe('CartCheckoutService integration', () => {
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
        { provide: MarketplaceCheckoutService, useValue: marketplaceMock },
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
  });

  it('checkout with 3 items creates one session via marketplace', async () => {
    marketplaceMock.checkoutLines.mockResolvedValue({
      sessionId: 'session-1',
      orderIds: ['o-1', 'o-2', 'o-3'],
      totalAmount: 540_000,
      discountAmount: 60_000,
      paymentUrl: 'https://gateway.test/pay',
    });

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'GATEWAY',
      couponCode: 'SAVE10',
      requiresVerification: false,
    });

    expect(marketplaceMock.checkoutLines).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({
        source: CheckoutSessionSource.CART,
        clearCart: true,
        items: expect.arrayContaining([
          expect.objectContaining({ listingId: 'l-1', lineTotal: 100_000 }),
          expect.objectContaining({ listingId: 'l-2', lineTotal: 200_000 }),
          expect.objectContaining({ listingId: 'l-3', lineTotal: 300_000 }),
        ]),
      }),
    );
    expect(result.sessionId).toBe('session-1');
    expect(result.orderIds).toEqual(['o-1', 'o-2', 'o-3']);
    expect(result.totalAmount).toBe(540_000);
    expect(result.paymentUrl).toBe('https://gateway.test/pay');
  });

  it('wallet checkout returns null paymentUrl from marketplace', async () => {
    marketplaceMock.checkoutLines.mockResolvedValue({
      sessionId: 'session-1',
      orderIds: ['o-1', 'o-2', 'o-3'],
      totalAmount: 600_000,
      discountAmount: 0,
      paymentUrl: null,
    });

    const result = await service.checkout('buyer-1', {
      addressId: 'addr-1',
      paymentMethod: 'WALLET',
      requiresVerification: false,
    });

    expect(result.paymentUrl).toBeNull();
    expect(marketplaceMock.checkoutLines).toHaveBeenCalledWith(
      'buyer-1',
      expect.objectContaining({ paymentMethod: 'WALLET' }),
    );
  });
});
