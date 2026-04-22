/**
 * تست یکپارچه‌سازی پنالتی مزایده — نیاز به دیتابیس واقعی و داده‌ی seed شده دارد.
 * برای اجرای دستی: این describe را از skip خارج کن و مطمئن شو DB در دسترس است.
 */
import { Test } from '@nestjs/testing';
import { AuctionService } from '../../modules/auction/auction.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletService } from '../../modules/wallet/wallet.service';
import { FeeCalculatorService } from '../../modules/fees/fee-calculator.service';
import { AuctionGateway } from '../../modules/auction/auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';

describe.skip('Auction Penalty (integration — requires DB)', () => {
  let auctionService: AuctionService;
  let prisma: PrismaService;

  let listingId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuctionService,
        WalletService,
        FeeCalculatorService,
        PrismaService,
        { provide: AuctionGateway, useValue: { emitBidPlaced: jest.fn(), emitAuctionFinished: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
      ],
    }).compile();

    auctionService = moduleRef.get(AuctionService);
    prisma = moduleRef.get(PrismaService);

    const auction = await prisma.listingAuction.findFirst({
      where: {
        settlementStatus: 'PENDING',
      },
    });

    if (!auction) {
      throw new Error('No pending auction found for penalty test');
    }

    listingId = auction.listingId;
  });

  it('should penalize winner if payment deadline passed', async () => {
    await prisma.listingAuction.update({
      where: { listingId },
      data: {
        paymentDeadline: new Date(Date.now() - 60_000),
      },
    });

    await auctionService.penalizeWinner(listingId);

    const auction = await prisma.listingAuction.findUnique({
      where: { listingId },
    });

    expect(auction!.settlementStatus).toBe('PENALIZED');
  });
});
