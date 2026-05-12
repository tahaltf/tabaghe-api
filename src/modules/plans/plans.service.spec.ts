import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlansService } from './plans.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BUILTIN_FREE_PLAN_ID } from './builtin-free-plan';

describe('PlansService', () => {
  let service: PlansService;

  const prismaMock = {
    plan: { findMany: jest.fn(), findUnique: jest.fn() },
    systemSetting: { findUnique: jest.fn() },
    userPlanPurchase: { create: jest.fn() },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        plan: { findUnique: jest.fn() },
        userPlanPurchase: { create: jest.fn() },
      }),
    ),
  };

  const walletMock = {
    payFromAvailable: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaMock.systemSetting.findUnique.mockResolvedValue({ value: '3' });
    prismaMock.plan.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getActivePlans prepends builtin free plan', async () => {
    prismaMock.systemSetting.findUnique.mockResolvedValue({ value: '4' });
    prismaMock.plan.findMany.mockResolvedValue([
      {
        id: 'paid1',
        title: 'پلن پولی',
        description: null,
        price: 100_000,
        isActive: true,
        rules: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const rows = await service.getActivePlans();
    const first = rows[0] as { id: string; isBuiltinFree?: boolean; rules: { count: number }[] };
    expect(first.id).toBe(BUILTIN_FREE_PLAN_ID);
    expect(first.isBuiltinFree).toBe(true);
    expect(first.rules[0].count).toBe(4);
    expect(rows[1].id).toBe('paid1');
  });

  it('buyPlan rejects builtin free plan', async () => {
    await expect(
      service.buyPlan('user-1', BUILTIN_FREE_PLAN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
