import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { OrdersStateMachineService } from './orders-state-machine.service';

describe('OrdersService', () => {
  let service: OrdersService;

  const prismaMock = {
    order: { findMany: jest.fn() },
  };

  const walletMock = {};
  const feeMock = {};
  const configMock = { get: jest.fn() };
  const stateMachineMock = {
    canTransition: jest.fn(),
    assertTransition: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        { provide: FeeCalculatorService, useValue: feeMock },
        { provide: ConfigService, useValue: configMock },
        { provide: OrdersStateMachineService, useValue: stateMachineMock },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
