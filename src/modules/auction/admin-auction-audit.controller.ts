import {
    Controller,
    Get,
    Param,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import Decimal from 'decimal.js';

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuctionAuditController {
    constructor(private readonly prisma: PrismaService) {}

    @Get(':listingId/financial')
    async getAuctionFinancial(@Param('listingId') listingId: string) {
        const [auction, order, txns] = await Promise.all([
            this.prisma.listingAuction.findUnique({
            where: { listingId },
            include: {
                listing: {
                    include: {
                        category: {
                            select: {
                                title: true,
                                auctionDepositPercent: true,
                                feePercentageAuction: true,
                                feeCapAuction: true,
                            },
                        },
                    },
                },
                bids: {
                    orderBy: [{ amount: 'desc' }, { createdAt: 'asc' }],
                    select: {
                        id: true,
                        bidderId: true,
                        bidder: {
                            select: {
                                firstName: true,
                                lastName: true,
                                phone: true,
                            },
                        },
                        amount: true,
                        blockedAmount: true,
                        status: true,
                        createdAt: true,
                    },
                },
            },
        }),
            this.prisma.order.findUnique({
                where: { listingId },
                select: {
                    id: true,
                    status: true,
                    type: true,
                    finalPrice: true,
                    totalAmount: true,
                    shippingCost: true,
                    verificationFee: true,
                    platformFee: true,
                    sellerRevenue: true,
                    paymentMethod: true,
                    createdAt: true,
                    updatedAt: true,
                    buyerId: true,
                    sellerId: true,
                },
            }),
            this.prisma.walletTransaction.findMany({
                where: { referenceId: listingId },
                select: {
                    id: true,
                    walletId: true,
                    type: true,
                    status: true,
                    amount: true,
                    createdAt: true,
                },
                orderBy: { createdAt: 'asc' },
            }),
        ]);

        if (!auction) {
            return { exists: false };
        }

        const winnerBid = auction.bids.find((b) => b.status === 'WON')
            ?? auction.bids.find((b) => b.bidderId === auction.highestBidderId)
            ?? null;
        const highestActive = auction.bids.find((b) => b.status === 'ACTIVE') ?? null;
        const finalBidAmount = new Decimal(
            winnerBid?.amount ?? auction.highestBidAmount ?? highestActive?.amount ?? 0,
        );
        const winnerDepositUsed = new Decimal(winnerBid?.blockedAmount ?? 0);

        const shippingCost = new Decimal(order?.shippingCost ?? 0);
        const verificationFee = new Decimal(order?.verificationFee ?? 0);
        const platformFee = new Decimal(order?.platformFee ?? 0);
        const sellerRevenue = new Decimal(order?.sellerRevenue ?? 0);
        const payableRemainder = Decimal.max(
            finalBidAmount.minus(winnerDepositUsed),
            new Decimal(0),
        );

        const totalBlockedAcrossBidders = auction.bids.reduce(
            (acc, b) => acc.plus(b.blockedAmount ?? 0),
            new Decimal(0),
        );

        const txTotals = txns.reduce(
            (acc, t) => {
                const amount = new Decimal(t.amount ?? 0);
                if (t.type === 'BLOCK') acc.block = acc.block.plus(amount);
                if (t.type === 'UNBLOCK') acc.unblock = acc.unblock.plus(amount);
                if (t.type === 'PENALTY') acc.penalty = acc.penalty.plus(amount);
                if (t.type === 'SETTLEMENT') acc.settlement = acc.settlement.plus(amount);
                if (t.type === 'DEPOSIT') acc.deposit = acc.deposit.plus(amount);
                return acc;
            },
            {
                block: new Decimal(0),
                unblock: new Decimal(0),
                penalty: new Decimal(0),
                settlement: new Decimal(0),
                deposit: new Decimal(0),
            },
        );

        return {
            listingId,
            exists: true,
            listing: {
                id: auction.listingId,
                title: auction.listing.title,
                sellerId: auction.listing.authorId,
                categoryTitle: auction.listing.category?.title ?? null,
                categoryAuctionDepositPercent:
                    auction.listing.category?.auctionDepositPercent ?? null,
                categoryAuctionFeePercent:
                    auction.listing.category?.feePercentageAuction ?? null,
                categoryAuctionFeeCap: auction.listing.category?.feeCapAuction ?? null,
            },
            auction: {
                status: auction.status,
                settlementStatus: auction.settlementStatus,
                highestBidderId: auction.highestBidderId,
                highestBidAmount: auction.highestBidAmount,
                basePrice: auction.basePrice,
                minBidIncrement: auction.minBidIncrement,
                endDatetime: auction.endDatetime,
                paymentDeadline: auction.paymentDeadline,
                finishedAt: auction.finishedAt,
                bidsCount: auction.bids.length,
            },
            financialBreakdown: {
                finalBidAmount: finalBidAmount.toNumber(),
                winnerDepositUsed: winnerDepositUsed.toNumber(),
                payableRemainder: payableRemainder.toNumber(),
                shippingCost: shippingCost.toNumber(),
                verificationFee: verificationFee.toNumber(),
                platformFee: platformFee.toNumber(),
                sellerRevenue: sellerRevenue.toNumber(),
                totalBuyerOutOfPocket: payableRemainder.plus(shippingCost).plus(verificationFee).toNumber(),
                totalBlockedAcrossBidders: totalBlockedAcrossBidders.toNumber(),
            },
            order: order
                ? {
                    id: order.id,
                    status: order.status,
                    type: order.type,
                    paymentMethod: order.paymentMethod,
                    buyerId: order.buyerId,
                    sellerId: order.sellerId,
                    createdAt: order.createdAt,
                    updatedAt: order.updatedAt,
                }
                : null,
            bidLedger: auction.bids.map((b) => ({
                id: b.id,
                bidderId: b.bidderId,
                bidderName: `${b.bidder?.firstName ?? ''} ${b.bidder?.lastName ?? ''}`.trim() || null,
                bidderPhone: b.bidder?.phone ?? null,
                amount: Number(b.amount),
                blockedAmount: Number(b.blockedAmount),
                status: b.status,
                createdAt: b.createdAt,
            })),
            walletLedgerSummary: {
                txCount: txns.length,
                block: txTotals.block.toNumber(),
                unblock: txTotals.unblock.toNumber(),
                penalty: txTotals.penalty.toNumber(),
                settlement: txTotals.settlement.toNumber(),
                deposit: txTotals.deposit.toNumber(),
            },
        };
    }
}
