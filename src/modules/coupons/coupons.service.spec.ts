import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { CouponScopeMode } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CouponsService } from './coupons.service';

describe('CouponsService', () => {
  let service: CouponsService;

  const prismaMock = {
    coupon: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    couponRedemption: { count: jest.fn() },
    listing: { findUnique: jest.fn() },
  };

  const activePercentCoupon = {
    id: 'coupon-1',
    code: 'SAVE10',
    isActive: true,
    startsAt: null,
    expiresAt: null,
    discountType: 'PERCENT',
    discountValue: 10,
    maxDiscountAmount: 50000,
    minOrderAmount: null,
    maxUsesTotal: 100,
    maxUsesPerUser: 5,
    usedCount: 0,
    allowOnSaleItems: true,
    scopeMode: CouponScopeMode.ALL,
    categoryIds: [] as string[],
    listingIds: [] as string[],
    userIds: [] as string[],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CouponsService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();
    service = module.get(CouponsService);
  });

  it('applies percent discount capped by maxDiscountAmount', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue(activePercentCoupon);
    prismaMock.couponRedemption.count.mockResolvedValue(0);

    const result = await service.validateForCart('user-1', 'save10', [
      {
        listingId: 'l-1',
        quantity: 2,
        unitPrice: 600_000,
        categoryId: 'cat-1',
        onSale: false,
      },
    ]);

    expect(result.discountAmount).toBe(50_000);
    expect(result.couponId).toBe('coupon-1');
  });

  it('rejects when max uses total reached', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      ...activePercentCoupon,
      usedCount: 100,
    });

    await expect(
      service.validateForCart('user-1', 'SAVE10', [
        {
          listingId: 'l-1',
          quantity: 1,
          unitPrice: 100_000,
          categoryId: 'cat-1',
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('INCLUDE scope only discounts matching category or listing', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      ...activePercentCoupon,
      scopeMode: CouponScopeMode.INCLUDE,
      categoryIds: ['cat-match'],
      listingIds: [],
    });
    prismaMock.couponRedemption.count.mockResolvedValue(0);

    const result = await service.validateForCart('user-1', 'SAVE10', [
      {
        listingId: 'l-1',
        quantity: 1,
        unitPrice: 100_000,
        categoryId: 'cat-other',
        onSale: false,
      },
      {
        listingId: 'l-2',
        quantity: 1,
        unitPrice: 200_000,
        categoryId: 'cat-match',
        onSale: false,
      },
    ]);

    expect(result.eligibleSubtotal).toBe(200_000);
    expect(result.discountAmount).toBe(20_000);
  });

  it('EXCLUDE scope skips listed categories', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      ...activePercentCoupon,
      scopeMode: CouponScopeMode.EXCLUDE,
      categoryIds: ['cat-excluded'],
      listingIds: [],
    });
    prismaMock.couponRedemption.count.mockResolvedValue(0);

    const result = await service.validateForCart('user-1', 'SAVE10', [
      {
        listingId: 'l-1',
        quantity: 1,
        unitPrice: 100_000,
        categoryId: 'cat-excluded',
        onSale: false,
      },
      {
        listingId: 'l-2',
        quantity: 1,
        unitPrice: 300_000,
        categoryId: 'cat-ok',
        onSale: false,
      },
    ]);

    expect(result.eligibleSubtotal).toBe(300_000);
    expect(result.discountAmount).toBe(30_000);
  });

  it('rejects sale items when allowOnSaleItems is false', async () => {
    prismaMock.coupon.findUnique.mockResolvedValue({
      ...activePercentCoupon,
      allowOnSaleItems: false,
    });
    prismaMock.couponRedemption.count.mockResolvedValue(0);

    await expect(
      service.validateForCart('user-1', 'SAVE10', [
        {
          listingId: 'l-1',
          quantity: 1,
          unitPrice: 80_000,
          categoryId: 'cat-1',
          onSale: true,
        },
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
