import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuctionService } from './auction.service';
import { AuctionSettlementStatus, AuctionStatus } from '@prisma/client';

@Injectable()
export class AuctionScheduler {
    private readonly logger = new Logger(AuctionScheduler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly auctionService: AuctionService,
    ) {}

    /**
     * Runs every minute
     * Penalizes auction winners who missed payment deadline
     */
    @Cron(CronExpression.EVERY_MINUTE)
    async handleAuctionPaymentTimeouts() {
        const now = new Date();

        const expiredAuctions = await this.prisma.listingAuction.findMany({
            where: {
                status: AuctionStatus.FINISHED,
                settlementStatus: AuctionSettlementStatus.PENDING,
                paymentDeadline: {
                    lt: now,
                },
            },
            select: {
                listingId: true,
            },
        });

        if (expiredAuctions.length === 0) return;

        for (const auction of expiredAuctions) {
            try {
                await this.auctionService.penalizeWinner(auction.listingId);
            } catch (err) {
                this.logger.error(
                    `Failed to penalize auction ${auction.listingId}`,
                    err instanceof Error ? err.stack : undefined,
                );
            }
        }
    }
}
