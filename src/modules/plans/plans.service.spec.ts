import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PlansService } from './plans.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { BUILTIN_FREE_PLAN_ID } from './builtin-free-plan';
import { PlanLifecycleService } from './plan-lifecycle.service';
import { AiTokenService } from '../ai-content/services/ai-token.service';
import { AiContentSettingsService } from '../ai-content/services/ai-content-settings.service';

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
    prismaMock.systemSetting.findUnique.mockImplementation(
      ({ where }: { where: { key: string } }) => {
        if (where.key === 'FREE_DIRECT_QUOTA') {
          return Promise.resolve({ value: '3' });
        }
        if (where.key === 'FREE_EXCHANGE_QUOTA') {
          return Promise.resolve({ value: '1' });
        }
        return Promise.resolve(null);
      },
    );
    prismaMock.plan.findMany.mockResolvedValue([]);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlansService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        {
          provide: PlanLifecycleService,
          useValue: { notifyPlanChange: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: AiTokenService,
          useValue: {
            resetPlanTokens: jest.fn().mockResolvedValue(undefined),
            expirePlanTokens: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: AiContentSettingsService,
          useValue: { isEnabled: jest.fn().mockResolvedValue(false) },
        },
      ],
    }).compile();

    service = module.get<PlansService>(PlansService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('getActivePlans prepends builtin free plan', async () => {
    prismaMock.systemSetting.findUnique.mockImplementation(
      ({ where }: { where: { key: string } }) => {
        if (where.key === 'FREE_DIRECT_QUOTA') {
          return Promise.resolve({ value: '4' });
        }
        if (where.key === 'FREE_EXCHANGE_QUOTA') {
          return Promise.resolve({ value: '1' });
        }
        return Promise.resolve(null);
      },
    );
    prismaMock.plan.findMany.mockResolvedValue([
      {
        id: 'paid1',
        title: 'پلن پولی',
        marketingTitle: null,
        description: null,
        price: 100_000,
        isActive: true,
        aiTokensPerMonth: 30,
        rules: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const rows = await service.getActivePlans();
    const first = rows[0] as {
      id: string;
      isBuiltinFree?: boolean;
      rules: { count: number }[];
    };
    expect(first.id).toBe(BUILTIN_FREE_PLAN_ID);
    expect(first.isBuiltinFree).toBe(true);
    expect(first.rules[0].count).toBe(4);
    expect(rows[1].id).toBe('paid1');
    expect(
      (rows[1] as { aiTokensPerMonth?: number }).aiTokensPerMonth,
    ).toBeUndefined();
  });

  it('buyPlan rejects builtin free plan', async () => {
    await expect(
      service.buyPlan('user-1', BUILTIN_FREE_PLAN_ID),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
