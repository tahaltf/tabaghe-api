import { VerificationFeeMode } from '@prisma/client';
import { VerificationFeeCalculatorService } from './verification-fee-calculator.service';

describe('VerificationFeeCalculatorService', () => {
  const prismaMock: any = {
    verificationFeeRule: {
      findMany: jest.fn(),
    },
    systemSetting: {
      findUnique: jest.fn(),
    },
  };

  let service: VerificationFeeCalculatorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new VerificationFeeCalculatorService(prismaMock);
  });

  it('returns FIXED feeValue when a global rule matches', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.FIXED,
        feeValue: 200_000,
        feeCap: null,
      },
    ]);

    const fee = await service.resolve(null, 1_000_000);
    expect(fee).toBe(200_000);
  });

  it('computes PERCENT fee and applies feeCap', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.PERCENT,
        feeValue: 10,
        feeFloor: null,
        feeCap: 150_000,
      },
    ]);

    const fee = await service.resolve('cat-1', 5_000_000);
    // 10% of 5_000_000 = 500_000, capped to 150_000
    expect(fee).toBe(150_000);
  });

  it('computes PERCENT fee and applies feeFloor', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.PERCENT,
        feeValue: 10,
        feeFloor: 50_000,
        feeCap: null,
      },
    ]);

    const fee = await service.resolve('cat-1', 100_000);
    // 10% of 100_000 = 10_000, floored to 50_000
    expect(fee).toBe(50_000);
  });

  it('ignores feeFloor for FIXED mode', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.FIXED,
        feeValue: 20_000,
        feeFloor: 50_000,
        feeCap: 100_000,
      },
    ]);

    const fee = await service.resolve(null, 1_000_000);
    expect(fee).toBe(20_000);
  });

  it('prefers category-specific rule over global', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: 'phones',
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.FIXED,
        feeValue: 80_000,
        feeCap: null,
      },
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: null,
        mode: VerificationFeeMode.FIXED,
        feeValue: 250_000,
        feeCap: null,
      },
    ]);

    const fee = await service.resolve('phones', 2_000_000);
    expect(fee).toBe(80_000);
  });

  it('picks highest matching minPrice within range', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([
      {
        categoryId: null,
        minPrice: 5_000_000,
        maxPrice: null,
        mode: VerificationFeeMode.FIXED,
        feeValue: 400_000,
        feeCap: null,
      },
      {
        categoryId: null,
        minPrice: 0,
        maxPrice: 4_999_999,
        mode: VerificationFeeMode.FIXED,
        feeValue: 100_000,
        feeCap: null,
      },
    ]);

    const fee = await service.resolve(null, 6_000_000);
    expect(fee).toBe(400_000);
  });

  it('falls back to VERIFICATION_FEE setting when no rule matches', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([]);
    prismaMock.systemSetting.findUnique.mockResolvedValue({ value: '333000' });

    const fee = await service.resolve('unknown', 1000);
    expect(fee).toBe(333_000);
  });

  it('falls back to 250000 when setting missing', async () => {
    prismaMock.verificationFeeRule.findMany.mockResolvedValue([]);
    prismaMock.systemSetting.findUnique.mockResolvedValue(null);

    const fee = await service.resolve(null, 1000);
    expect(fee).toBe(250_000);
  });

  it('resolves different fees for exchange parties by own item price', async () => {
    prismaMock.verificationFeeRule.findMany.mockImplementation(
      async ({ where }: { where: { minPrice: { lte: string } } }) => {
        const price = Number(where.minPrice.lte);
        if (price >= 5_000_000) {
          return [
            {
              categoryId: 'phones',
              minPrice: 5_000_000,
              maxPrice: null,
              mode: VerificationFeeMode.FIXED,
              feeValue: 400_000,
              feeCap: null,
            },
          ];
        }
        return [
          {
            categoryId: 'phones',
            minPrice: 0,
            maxPrice: 4_999_999,
            mode: VerificationFeeMode.FIXED,
            feeValue: 100_000,
            feeCap: null,
          },
        ];
      },
    );

    const sellerFee = await service.resolve('phones', 6_000_000);
    const offererFee = await service.resolve('phones', 3_000_000);
    expect(sellerFee).toBe(400_000);
    expect(offererFee).toBe(100_000);
  });
});
