import {
    Controller,
    Get,
    Param,
    UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuctionAuditController {
    constructor(private readonly prisma: PrismaService) {}

    @Get(':listingId/financial')
    async getAuctionFinancial(@Param('listingId') listingId: string) {
        const auction = await this.prisma.listingAuction.findUnique({
            where: { listingId },
            include: {
                listing: true,
                bids: true,
            },
        });

        if (!auction) {
            return { exists: false };
        }

        return {
            listingId,
            sellerId: auction.listing.authorId,
            highestBidderId: auction.highestBidderId,
            highestBidAmount: auction.highestBidAmount,
            status: auction.status,
            settlementStatus: auction.settlementStatus,
            paymentDeadline: auction.paymentDeadline,
            bidsCount: auction.bids.length,
        };
    }
}
