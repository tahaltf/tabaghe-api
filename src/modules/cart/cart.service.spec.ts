import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { ListingStatus, ListingType } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { UserActionRateLimitService } from '../../common/services/user-action-rate-limit.service';
import { PurchaseOfferService } from '../purchase-offer/purchase-offer.service';
import { CartService } from './cart.service';
import { CurrencyService } from '../currency/currency.service';

describe('CartService', () => {
  let service: CartService;

  const prismaMock = {
    cart: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    cartItem: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    listing: { findUnique: jest.fn() },
    listingVariation: { findFirst: jest.fn() },
  };

  const currencyMock = {
    toToman: jest.fn(async (amount: number) => amount),
  };

  const purchaseOfferMock = {
    isListingReservedForOther: jest.fn().mockResolvedValue(false),
  };

  const rateLimitMock = {
    consumeOrThrow: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    rateLimitMock.consumeOrThrow.mockResolvedValue(undefined);
    purchaseOfferMock.isListingReservedForOther.mockResolvedValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CartService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PurchaseOfferService, useValue: purchaseOfferMock },
        { provide: UserActionRateLimitService, useValue: rateLimitMock },
        { provide: CurrencyService, useValue: currencyMock },
      ],
    }).compile();
    service = module.get(CartService);
  });

  it('rejects adding item from a different seller', async () => {
    prismaMock.listing.findUnique.mockResolvedValue({
      id: 'listing-b',
      type: ListingType.DIRECT,
      status: ListingStatus.APPROVED,
      authorId: 'seller-b',
      stockQuantity: 5,
      singleItemSale: false,
      isVariable: false,
      direct: { price: 100_000, salePrice: null, compareAtPrice: null },
      author: { id: 'seller-b' },
    });
    prismaMock.cart.findUnique.mockResolvedValue({
      id: 'cart-1',
      userId: 'buyer-1',
      sellerId: 'seller-a',
    });

    await expect(
      service.addItem('buyer-1', 'listing-b', 1),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('caps quantity by stock when adding item', async () => {
    prismaMock.listing.findUnique.mockResolvedValue({
      id: 'listing-1',
      type: ListingType.DIRECT,
      status: ListingStatus.APPROVED,
      authorId: 'seller-a',
      stockQuantity: 3,
      singleItemSale: false,
      isVariable: false,
      direct: { price: 100_000, salePrice: null, compareAtPrice: null },
      author: { id: 'seller-a' },
    });
    prismaMock.cart.findUnique.mockResolvedValue(null);
    prismaMock.cart.create.mockResolvedValue({
      id: 'cart-1',
      userId: 'buyer-1',
      sellerId: 'seller-a',
    });
    prismaMock.cartItem.findUnique.mockResolvedValue(null);
    prismaMock.cartItem.upsert.mockResolvedValue({});

    await service.addItem('buyer-1', 'listing-1', 10);

    expect(prismaMock.cartItem.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ quantity: 3, variationKey: '' }),
        update: expect.objectContaining({ quantity: 3 }),
      }),
    );
  });

  it('rejects a variable listing without a variation id', async () => {
    prismaMock.listing.findUnique.mockResolvedValue({
      id: 'listing-1',
      type: ListingType.DIRECT,
      status: ListingStatus.APPROVED,
      authorId: 'seller-a',
      stockQuantity: 4,
      singleItemSale: false,
      isVariable: true,
      direct: { price: 100_000, salePrice: null, compareAtPrice: null },
      author: { id: 'seller-a' },
    });

    await expect(service.addItem('buyer-1', 'listing-1', 1)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prismaMock.cartItem.upsert).not.toHaveBeenCalled();
  });

  it('stores two variations of the same listing as separate cart lines', async () => {
    prismaMock.listing.findUnique.mockResolvedValue({
      id: 'listing-1',
      type: ListingType.DIRECT,
      status: ListingStatus.APPROVED,
      authorId: 'seller-a',
      stockQuantity: 4,
      singleItemSale: false,
      isVariable: true,
      direct: { price: 80_000, salePrice: null, compareAtPrice: null },
      author: { id: 'seller-a' },
    });
    prismaMock.cart.findUnique.mockResolvedValue({
      id: 'cart-1',
      userId: 'buyer-1',
      sellerId: 'seller-a',
      items: [],
    });
    prismaMock.cartItem.findUnique.mockResolvedValue(null);
    prismaMock.cartItem.upsert.mockResolvedValue({});
    prismaMock.listingVariation.findFirst
      .mockResolvedValueOnce({
        id: 'var-red',
        listingId: 'listing-1',
        isActive: true,
        stockQuantity: 2,
        price: 100_000,
        salePrice: null,
        compareAtPrice: null,
        attributes: [{ name: 'رنگ', value: 'قرمز' }],
      })
      .mockResolvedValueOnce({
        id: 'var-blue',
        listingId: 'listing-1',
        isActive: true,
        stockQuantity: 2,
        price: 90_000,
        salePrice: null,
        compareAtPrice: null,
        attributes: [{ name: 'رنگ', value: 'آبی' }],
      });

    await service.addItem('buyer-1', 'listing-1', 1, 'var-red');
    await service.addItem('buyer-1', 'listing-1', 1, 'var-blue');

    expect(prismaMock.cartItem.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        create: expect.objectContaining({
          variationId: 'var-red',
          variationKey: 'var-red',
        }),
      }),
    );
    expect(prismaMock.cartItem.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        create: expect.objectContaining({
          variationId: 'var-blue',
          variationKey: 'var-blue',
        }),
      }),
    );
  });
});
