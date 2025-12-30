import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import {
    AuctionBidStatus,
    AuctionStatus,
    AuctionSettlementStatus,
} from '@prisma/client';
import Decimal from 'decimal.js';
import { AuctionGateway } from './auction.gateway';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuctionEvents } from './auction.events';

@Injectable()
export class AuctionService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly walletService: WalletService,
        private readonly auctionGateway: AuctionGateway,
        private readonly eventEmitter: EventEmitter2,
    ) {}

    // -----------------------------------
    // Place bid
    // -----------------------------------
    async placeBid(userId: string, listingId: string, amount: number) {
        const bidAmount = new Decimal(amount);
        if (bidAmount.lte(0)) {
            throw new BadRequestException('Invalid bid amount');
        }

        const result = await this.prisma.$transaction(async (tx) => {
            const auction = await tx.listingAuction.findUnique({
                where: { listingId },
            });

            if (!auction) throw new NotFoundException('Auction not found');
            if (auction.status !== AuctionStatus.ACTIVE) {
                throw new ForbiddenException('Auction is not active');
            }
            if (new Date() >= auction.endDatetime) {
                throw new ForbiddenException('Auction has ended');
            }

            const currentHighest = auction.highestBidAmount
                ? new Decimal(auction.highestBidAmount)
                : null;

            const minRequired = currentHighest
                ? currentHighest.plus(auction.minBidIncrement)
                : new Decimal(auction.basePrice);

            if (bidAmount.lt(minRequired)) {
                throw new BadRequestException(
                    `Bid must be >= ${minRequired.toString()}`,
                );
            }

            if (auction.highestBidderId === userId) {
                throw new BadRequestException('You already have the highest bid');
            }

            // 1️⃣ block bidder money
            await this.walletService.blockAmount(userId, bidAmount, {
                type: 'AUCTION_BID_BLOCK',
                listingId,
            });

            // 2️⃣ create bid
            const newBid = await tx.auctionBid.create({
                data: {
                    listingId,
                    bidderId: userId,
                    amount: bidAmount,
                    status: AuctionBidStatus.ACTIVE,
                },
            });

            // 3️⃣ outbid previous highest
            if (auction.highestBidderId && auction.highestBidAmount) {
                const prevBid = await tx.auctionBid.findFirst({
                    where: {
                        listingId,
                        bidderId: auction.highestBidderId,
                        status: AuctionBidStatus.ACTIVE,
                    },
                    orderBy: { createdAt: 'desc' },
                });

                if (prevBid) {
                    await tx.auctionBid.update({
                        where: { id: prevBid.id },
                        data: { status: AuctionBidStatus.OUTBID },
                    });
                }

                await this.walletService.unblockAmount(
                    auction.highestBidderId,
                    new Decimal(auction.highestBidAmount),
                    { type: 'AUCTION_OUTBID_UNBLOCK', listingId },
                );

                // 🔔 notify outbid
                this.eventEmitter.emit(AuctionEvents.OUTBID, {
                    listingId,
                    userId: auction.highestBidderId,
                });
            }

            // 4️⃣ update auction cache
            await tx.listingAuction.update({
                where: { listingId },
                data: {
                    highestBidAmount: bidAmount,
                    highestBidderId: userId,
                },
            });

            return newBid;
        });

        // realtime + event
        this.auctionGateway.emitBidPlaced(listingId, {
            bidderId: userId,
            amount: result.amount,
        });

        this.eventEmitter.emit(AuctionEvents.BID_PLACED, {
            listingId,
            bidderId: userId,
            amount: bidAmount.toString(),
        });

        return { ok: true, bid: result };
    }

    // -----------------------------------
    // Finalize auction (NO SETTLEMENT)
    // -----------------------------------
    async finalizeAuction(listingId: string) {
        const result = await this.prisma.$transaction(async (tx) => {
            const auction = await tx.listingAuction.findUnique({
                where: { listingId },
            });

            if (!auction) throw new NotFoundException('Auction not found');
            if (auction.status === AuctionStatus.FINISHED) return null;
            if (auction.endDatetime > new Date()) {
                throw new BadRequestException('Auction not ended yet');
            }

            const bids = await tx.auctionBid.findMany({
                where: { listingId },
                orderBy: { amount: 'desc' },
            });

            if (bids.length === 0) {
                await tx.listingAuction.update({
                    where: { listingId },
                    data: {
                        status: AuctionStatus.FINISHED,
                        finishedAt: new Date(),
                    },
                });
                return { winner: null };
            }

            const winnerBid = bids[0];

            // unblock losers
            for (const bid of bids.slice(1)) {
                await this.walletService.unblockAmount(
                    bid.bidderId,
                    bid.amount,
                    { reason: 'AUCTION_LOST', listingId },
                );

                await tx.auctionBid.update({
                    where: { id: bid.id },
                    data: { status: AuctionBidStatus.LOST },
                });
            }

            await tx.auctionBid.update({
                where: { id: winnerBid.id },
                data: { status: AuctionBidStatus.WON },
            });

            await tx.listingAuction.update({
                where: { listingId },
                data: {
                    status: AuctionStatus.FINISHED,
                    settlementStatus: AuctionSettlementStatus.PENDING,
                    paymentDeadline: new Date(Date.now() + 30 * 60 * 1000),
                    finishedAt: new Date(),
                },
            });

            return {
                winnerUserId: winnerBid.bidderId,
                amount: winnerBid.amount,
            };
        });

        if (result?.winnerUserId) {
            this.auctionGateway.emitAuctionFinished(listingId, result);

            this.eventEmitter.emit(AuctionEvents.FINISHED, {
                listingId,
                winnerUserId: result.winnerUserId,
                amount: result.amount.toString(),
            });
        }

        return result;
    }

    // -----------------------------------
    // Pay auction
    // -----------------------------------
    async payAuction(userId: string, listingId: string) {
        return this.prisma.$transaction(async (tx) => {
            const auction = await tx.listingAuction.findUnique({
                where: { listingId },
                include: { listing: true },
            });

            if (!auction) throw new NotFoundException('Auction not found');
            if (auction.highestBidderId !== userId) {
                throw new ForbiddenException('Only winner can pay');
            }
            if (auction.settlementStatus !== AuctionSettlementStatus.PENDING) {
                throw new BadRequestException('Already settled');
            }
            if (!auction.paymentDeadline || auction.paymentDeadline < new Date()) {
                throw new BadRequestException('Payment expired');
            }

            const amount = new Decimal(auction.highestBidAmount!);

            await this.walletService.settleBlockedAmount(
                userId,
                amount,
                { reason: 'AUCTION_WIN_PAY', listingId },
            );

            await this.walletService.transfer({
                fromUserId: userId,
                toUserId: auction.listing.authorId,
                amount,
                reference: `AUCTION_WIN:${listingId}`,
                tx,
            });

            await tx.listingAuction.update({
                where: { listingId },
                data: {
                    settlementStatus: AuctionSettlementStatus.PAID,
                },
            });

            return { ok: true };
        });
    }

    // -----------------------------------
    // Penalize winner
    // -----------------------------------
    async penalizeWinner(listingId: string) {
        const auction = await this.prisma.listingAuction.findUnique({
            where: { listingId },
        });

        if (
            !auction ||
            auction.settlementStatus !== AuctionSettlementStatus.PENDING ||
            !auction.highestBidAmount ||
            !auction.highestBidderId
        ) {
            return;
        }

        const amount = new Decimal(auction.highestBidAmount);
        const penalty = amount.mul(0.1);
        const refund = amount.minus(penalty);

        await this.walletService.settleBlockedAmount(
            auction.highestBidderId,
            penalty,
            { reason: 'AUCTION_PENALTY', listingId },
        );

        await this.walletService.unblockAmount(
            auction.highestBidderId,
            refund,
            { reason: 'AUCTION_REFUND', listingId },
        );

        await this.prisma.listingAuction.update({
            where: { listingId },
            data: {
                settlementStatus: AuctionSettlementStatus.PENALIZED,
            },
        });

        // 🔔 notify penalty
        this.eventEmitter.emit(AuctionEvents.PENALIZED, {
            listingId,
            userId: auction.highestBidderId,
            penalty: penalty.toString(),
        });
    }

    // -----------------------------------
    // Read APIs
    // -----------------------------------
    async getAuctionState(listingId: string) {
        const auction = await this.prisma.listingAuction.findUnique({
            where: { listingId },
            include: { listing: { select: { title: true } } },
        });

        if (!auction) throw new NotFoundException('Auction not found');

        const bidCount = await this.prisma.auctionBid.count({
            where: { listingId },
        });

        const remainingMs =
            auction.status === AuctionStatus.ACTIVE
                ? Math.max(0, auction.endDatetime.getTime() - Date.now())
                : 0;

        return {
            listingId,
            title: auction.listing.title,
            auctionStatus: auction.status,
            basePrice: auction.basePrice,
            highestBid: auction.highestBidAmount,
            highestBidderId: auction.highestBidderId,
            bidCount,
            buyNowEnabled: auction.buyNowEnabled,
            buyNowPrice: auction.buyNowPrice,
            endDatetime: auction.endDatetime,
            remainingMs,
        };
    }

    async getAuctionBids(listingId: string) {
        return this.prisma.auctionBid.findMany({
            where: { listingId },
            orderBy: { createdAt: 'desc' },
            select: {
                amount: true,
                bidderId: true,
                createdAt: true,
            },
        });
    }

    // -----------------------------------
    // Buy now
    // -----------------------------------
    async buyNow(userId: string, listingId: string) {
        const result = await this.prisma.$transaction(async (tx) => {
            const auction = await tx.listingAuction.findUnique({
                where: { listingId },
                include: { listing: true },
            });

            if (!auction) throw new NotFoundException('Auction not found');
            if (auction.status !== AuctionStatus.ACTIVE) {
                throw new ForbiddenException('Auction not active');
            }
            if (!auction.buyNowEnabled || !auction.buyNowPrice) {
                throw new BadRequestException('Buy Now not available');
            }

            const amount = new Decimal(auction.buyNowPrice);

            await this.walletService.payFromAvailable(
                userId,
                amount,
                { reason: 'BUY_NOW_PAY', listingId },
            );

            const bids = await tx.auctionBid.findMany({
                where: { listingId, status: AuctionBidStatus.ACTIVE },
            });

            for (const bid of bids) {
                await this.walletService.unblockAmount(
                    bid.bidderId,
                    bid.amount,
                    { reason: 'BUY_NOW_CANCEL_BID', listingId },
                );

                await tx.auctionBid.update({
                    where: { id: bid.id },
                    data: { status: AuctionBidStatus.CANCELLED },
                });
            }

            await tx.listingAuction.update({
                where: { listingId },
                data: {
                    status: AuctionStatus.FINISHED,
                    settlementStatus: AuctionSettlementStatus.PAID,
                    finishedAt: new Date(),
                    highestBidderId: userId,
                    highestBidAmount: amount,
                },
            });

            await this.walletService.transfer({
                fromUserId: userId,
                toUserId: auction.listing.authorId,
                amount,
                reference: `BUY_NOW:${listingId}`,
                tx,
            });

            return { buyerId: userId, amount };
        });

        this.auctionGateway.emitAuctionFinished(listingId, {
            type: 'BUY_NOW',
            buyerId: result.buyerId,
            amount: result.amount,
        });

        return { ok: true, ...result };
    }

    // -----------------------------------
    // Admin force actions
    // -----------------------------------
    async forceSettleAuction(listingId: string) {
        return this.prisma.$transaction(async (tx) => {
            const auction = await tx.listingAuction.findUnique({
                where: { listingId },
                include: { listing: true },
            });

            if (
                !auction ||
                auction.settlementStatus !== AuctionSettlementStatus.PENDING ||
                !auction.highestBidAmount ||
                !auction.highestBidderId
            ) {
                throw new ForbiddenException('Auction not force-settleable');
            }

            const amount = new Decimal(auction.highestBidAmount);

            await this.walletService.settleBlockedAmount(
                auction.highestBidderId,
                amount,
                { reason: 'ADMIN_FORCE_SETTLE', listingId },
            );

            await this.walletService.transfer({
                fromUserId: auction.highestBidderId,
                toUserId: auction.listing.authorId,
                amount,
                reference: `ADMIN_FORCE_SETTLE:${listingId}`,
                tx,
            });

            await tx.listingAuction.update({
                where: { listingId },
                data: {
                    settlementStatus: AuctionSettlementStatus.PAID,
                },
            });

            return { ok: true };
        });
    }

    async forcePenalizeAuction(listingId: string) {
        const auction = await this.prisma.listingAuction.findUnique({
            where: { listingId },
        });

        if (
            !auction ||
            auction.settlementStatus !== AuctionSettlementStatus.PENDING ||
            !auction.highestBidAmount ||
            !auction.highestBidderId
        ) {
            throw new ForbiddenException('Auction not penalizable');
        }

        const amount = new Decimal(auction.highestBidAmount);
        const penalty = amount.mul(0.1);
        const refund = amount.minus(penalty);

        await this.walletService.settleBlockedAmount(
            auction.highestBidderId,
            penalty,
            { reason: 'ADMIN_FORCE_PENALTY', listingId },
        );

        await this.walletService.unblockAmount(
            auction.highestBidderId,
            refund,
            { reason: 'ADMIN_FORCE_REFUND', listingId },
        );

        await this.prisma.listingAuction.update({
            where: { listingId },
            data: {
                settlementStatus: AuctionSettlementStatus.PENALIZED,
            },
        });

        return { ok: true };
    }

    async forceRefundAuction(listingId: string) {
        const auction = await this.prisma.listingAuction.findUnique({
            where: { listingId },
        });

        if (
            !auction ||
            auction.settlementStatus !== AuctionSettlementStatus.PENDING ||
            !auction.highestBidAmount ||
            !auction.highestBidderId
        ) {
            throw new ForbiddenException('Auction not refundable');
        }

        await this.walletService.unblockAmount(
            auction.highestBidderId,
            auction.highestBidAmount,
            { reason: 'ADMIN_FORCE_REFUND', listingId },
        );

        await this.prisma.listingAuction.update({
            where: { listingId },
            data: {
                settlementStatus: AuctionSettlementStatus.FAILED,
            },
        });

        return { ok: true };
    }
}
