import { AuctionService } from '../../modules/auction/auction.service';
import { AuctionSupportService } from '../../modules/auction/services/auction-support.service';
import { AuctionBiddingService } from '../../modules/auction/services/auction-bidding.service';
import { AuctionSettlementService } from '../../modules/auction/services/auction-settlement.service';
import { AuctionQueryService } from '../../modules/auction/services/auction-query.service';

function createAuctionService(deps: {
  prisma: unknown;
  wallet?: unknown;
  feeCalculator?: unknown;
  gateway?: unknown;
  eventEmitter?: unknown;
}) {
  const wallet = deps.wallet ?? {};
  const feeCalculator = deps.feeCalculator ?? {};
  const gateway = deps.gateway ?? {};
  const eventEmitter = deps.eventEmitter ?? { emit: jest.fn() };
  const support = new AuctionSupportService(deps.prisma as never);
  const bidding = new AuctionBiddingService(
    deps.prisma as never,
    wallet as never,
    feeCalculator as never,
    gateway as never,
    eventEmitter as never,
    support,
  );
  const settlement = new AuctionSettlementService(
    deps.prisma as never,
    wallet as never,
    feeCalculator as never,
    gateway as never,
    eventEmitter as never,
    support,
  );
  const query = new AuctionQueryService(deps.prisma as never, support);
  return new AuctionService(bidding, settlement, query);
}

describe('Auction timeout policy (unit)', () => {
  it('does not penalize in second chance round', async () => {
    const calls: any[] = [];
    const now = Date.now();

    const prismaMock: any = {
      listingAuction: {
        findMany: jest.fn().mockResolvedValue([
          {
            listingId: 'L1',
            finishedAt: new Date(now - 25 * 60 * 60 * 1000),
            paymentDeadline: new Date(now - 1_000),
          },
        ]),
      },
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(async (handler: any) => handler(prismaMock)),
    };

    const service = createAuctionService({
      prisma: prismaMock,
      eventEmitter: { emit: (...args: any[]) => calls.push(args) },
    });

    const processNextWinner = jest
      .spyOn(AuctionSettlementService.prototype as any, 'processNextWinner')
      .mockResolvedValue(undefined);

    await service.checkUnpaidAuctions();

    expect(processNextWinner).toHaveBeenCalledWith('L1', {
      mode: 'second_chance_timeout',
    });

    processNextWinner.mockRestore();
  });
});
