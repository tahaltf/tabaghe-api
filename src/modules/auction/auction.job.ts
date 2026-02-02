import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { AuctionStatus } from '@prisma/client';
import { AuctionService } from './auction.service';

@Injectable()
export class AuctionJob {
    private readonly logger = new Logger(AuctionJob.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auctionService: AuctionService,
    ) {}

    // هر دقیقه
    @Cron('*/1 * * * *')
    async autoFinalizeAuctions() {
        const now = new Date();

        const expiredAuctions = await this.prisma.listingAuction.findMany({
            where: {
                status: AuctionStatus.ACTIVE,
                endDatetime: {
                    lte: now,
                },
            },
            select: {
                listingId: true,
            },
            take: 10, // جلوگیری از overload
        });

        for (const auction of expiredAuctions) {
            try {
                await this.auctionService.finalizeAuction(auction.listingId);
                this.logger.log(
                    `Auction finalized: ${auction.listingId}`,
                );
            } catch (err) {
                this.logger.error(
                    `Failed to finalize auction ${auction.listingId}`,
                    err,
                );
            }
        }
    }
}
