import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ItemCondition, ListingType } from '@prisma/client';
import { WordPressSellerContextService } from './wordpress-seller-context.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CurrencyService } from '../../currency/currency.service';
import { FeeCalculatorService } from '../../fees/fee-calculator.service';
import { BASE_CURRENCY_CODE } from '../../currency/providers/fx-provider';

describe('WordPressSellerContextService', () => {
  let service: WordPressSellerContextService;

  const prismaMock = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const currencyMock = {
    normalizeCode: jest.fn((code?: string | null) =>
      (code ?? BASE_CURRENCY_CODE).trim().toUpperCase() || BASE_CURRENCY_CODE,
    ),
    listPublicEnabled: jest.fn(),
  };

  const feeCalculatorMock = {
    resolveListingFeePercent: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WordPressSellerContextService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: CurrencyService, useValue: currencyMock },
        { provide: FeeCalculatorService, useValue: feeCalculatorMock },
      ],
    }).compile();
    service = module.get(WordPressSellerContextService);
  });

  it('returns IRT plus allowed currencies from seller profile', async () => {
    prismaMock.user.findUnique.mockResolvedValue({
      allowedListingCurrencyCodes: ['USD', 'iqd'],
    });
    currencyMock.listPublicEnabled.mockResolvedValue([
      {
        code: 'IRT',
        nameFa: 'تومان',
        symbol: 'تومان',
        decimals: 0,
      },
      {
        code: 'USD',
        nameFa: 'دلار',
        symbol: '$',
        decimals: 2,
      },
      {
        code: 'AED',
        nameFa: 'درهم',
        symbol: 'د.إ',
        decimals: 2,
      },
      {
        code: 'IQD',
        nameFa: 'دینار',
        symbol: 'د.ع',
        decimals: 0,
      },
    ]);

    const result = await service.getSellerContext('user-1');

    expect(result.allowedCurrencyCodes).toEqual(
      expect.arrayContaining(['IRT', 'USD', 'IQD']),
    );
    expect(result.allowedCurrencyCodes).not.toContain('AED');
    expect(result.currencies.map((c) => c.code)).toEqual(['IRT', 'USD', 'IQD']);
  });

  it('throws when seller is missing', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    await expect(service.getSellerContext('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('resolves fee rate for DIRECT + NEW with seller id', async () => {
    feeCalculatorMock.resolveListingFeePercent.mockResolvedValue(3);

    await expect(service.getFeeRate('user-1', 'cat-1')).resolves.toEqual({
      feePercent: 3,
    });

    expect(feeCalculatorMock.resolveListingFeePercent).toHaveBeenCalledWith({
      categoryId: 'cat-1',
      listingType: ListingType.DIRECT,
      condition: ItemCondition.NEW,
      sellerId: 'user-1',
    });
  });
});
