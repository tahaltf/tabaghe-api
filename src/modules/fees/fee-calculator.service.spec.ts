import { Test, TestingModule } from '@nestjs/testing';
import { ItemCondition, ListingType } from '@prisma/client';
import { FeeCalculatorService } from './fee-calculator.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PlanFeeDiscountService } from './plan-fee-discount.service';

describe('FeeCalculatorService.resolveListingFeePercent', () => {
  let service: FeeCalculatorService;

  const prismaMock = {
    userCategoryFee: {
      findUnique: jest.fn(),
    },
    category: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeeCalculatorService,
        { provide: PrismaService, useValue: prismaMock },
        {
          provide: PlanFeeDiscountService,
          useValue: {
            getSellerDiscount: jest.fn(),
            applyDiscountAndBounds: jest.fn(),
          },
        },
      ],
    }).compile();
    service = module.get(FeeCalculatorService);
  });

  it('returns 0 when categoryId is missing', async () => {
    await expect(
      service.resolveListingFeePercent({
        categoryId: null,
        listingType: ListingType.DIRECT,
      }),
    ).resolves.toBe(0);
  });

  it('prefers user override over category default', async () => {
    prismaMock.userCategoryFee.findUnique.mockResolvedValue({
      feePercentageDirectNew: 2.5,
      feePercentageDirectUsed: null,
      feePercentageAuctionNew: null,
      feePercentageAuctionUsed: null,
    });

    await expect(
      service.resolveListingFeePercent({
        categoryId: 'cat-1',
        listingType: ListingType.DIRECT,
        condition: ItemCondition.NEW,
        sellerId: 'user-1',
      }),
    ).resolves.toBe(2.5);

    expect(prismaMock.category.findUnique).not.toHaveBeenCalled();
  });

  it('falls back to category feePercentageDirectNew', async () => {
    prismaMock.userCategoryFee.findUnique.mockResolvedValue(null);
    prismaMock.category.findUnique.mockResolvedValue({
      feePercentageDirectNew: 3,
      feePercentageDirectUsed: 4,
      feePercentageAuctionNew: 5,
      feePercentageAuctionUsed: 6,
      feePercentageDirect: 3,
      feePercentageAuction: 5,
      feePercentage: 3,
      feeCapDirect: null,
      feeFloorDirect: null,
      feeCapAuction: null,
      feeFloorAuction: null,
      feeCap: null,
      feeFloor: null,
    });

    await expect(
      service.resolveListingFeePercent({
        categoryId: 'cat-1',
        listingType: ListingType.DIRECT,
        condition: ItemCondition.NEW,
        sellerId: 'user-1',
      }),
    ).resolves.toBe(3);
  });
});
