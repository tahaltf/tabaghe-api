import { Test } from '@nestjs/testing';
import { AuctionService } from '../../src/modules/auction/auction.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WalletService } from '../../src/modules/wallet/wallet.service';

describe('Auction Penalty (Unit-like)', () => {
    let auctionService: AuctionService;
    let prisma: PrismaService;

    let listingId: string;

    beforeAll(async () => {
        const moduleRef = await Test.createTestingModule({
            providers: [
                AuctionService,
                WalletService,
                PrismaService,
            ],
        }).compile();

        auctionService = moduleRef.get(AuctionService);
        prisma = moduleRef.get(PrismaService);

        // ⚠️ فرض: auction قبلاً ساخته شده
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
        // 1️⃣ force deadline in past
        await prisma.listingAuction.update({
            where: { listingId },
            data: {
                paymentDeadline: new Date(Date.now() - 60_000),
            },
        });

        // 2️⃣ call service directly (cron simulation)
        await auctionService.penalizeWinner(listingId);

        // 3️⃣ assert
        const auction = await prisma.listingAuction.findUnique({
            where: { listingId },
        });

        expect(auction!.settlementStatus).toBe('PENALIZED');
    });
});
