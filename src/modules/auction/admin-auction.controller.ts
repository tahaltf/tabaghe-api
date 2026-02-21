import {
    Controller,
    Post,
    Param,
    UseGuards,
    ForbiddenException,
} from '@nestjs/common';
import { AuctionService } from './auction.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/auctions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminAuctionController {
    constructor(private readonly auctionService: AuctionService) {}

    // -----------------------------------
    // Force settle (admin override)
    // -----------------------------------
    @Post(':listingId/force-settle')
    async forceSettle(@Param('listingId') listingId: string) {
        return this.auctionService.forceSettleAuction(listingId);
    }

    // -----------------------------------
    // Force penalize
    // -----------------------------------
    @Post(':listingId/force-penalize')
    async forcePenalize(@Param('listingId') listingId: string) {
        return this.auctionService.forcePenalizeWinner(listingId);
    }

    // -----------------------------------
    // Force refund
    // -----------------------------------
    @Post(':listingId/refund')
    async refund(@Param('listingId') listingId: string) {
        return this.auctionService.forceRefundAuction(listingId);
    }
}
