import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionService } from './auction.service';
import { AuctionSupportService } from './services/auction-support.service';
import { AuctionBiddingService } from './services/auction-bidding.service';
import { AuctionSettlementService } from './services/auction-settlement.service';
import { AuctionQueryService } from './services/auction-query.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { FeeCalculatorService } from '../fees/fee-calculator.service';
import { AuctionGateway } from './auction.gateway';

describe('AuctionService', () => {
  let service: AuctionService;

  const prismaMock = {
    listingAuction: { findUnique: jest.fn() },
    $transaction: jest.fn(),
  };

  const walletMock = {};
  const feeMock = {};
  const gatewayMock = {
    emitBidPlaced: jest.fn(),
    emitAuctionFinished: jest.fn(),
  };
  const eventsMock = { emit: jest.fn(), emitAsync: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuctionSupportService,
        AuctionBiddingService,
        AuctionSettlementService,
        AuctionQueryService,
        AuctionService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: WalletService, useValue: walletMock },
        { provide: FeeCalculatorService, useValue: feeMock },
        { provide: AuctionGateway, useValue: gatewayMock },
        { provide: EventEmitter2, useValue: eventsMock },
      ],
    }).compile();

    service = module.get<AuctionService>(AuctionService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
