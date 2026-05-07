import { AuctionService } from '../../modules/auction/auction.service';

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
      $transaction: jest.fn(async (handler: any) => handler(prismaMock)),
    };

    const service = new AuctionService(
      prismaMock,
      {} as any,
      {} as any,
      {} as any,
      { emit: (...args: any[]) => calls.push(args) } as any,
    );

    // patch private method invocation via bracket notation
    (service as any).processNextWinner = jest.fn().mockResolvedValue(undefined);

    await service.checkUnpaidAuctions();

    expect((service as any).processNextWinner).toHaveBeenCalledWith('L1', {
      penalizeCurrentWinner: false,
    });
  });
});

