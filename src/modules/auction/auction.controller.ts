import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
    Headers,
    BadRequestException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { AuctionService } from './auction.service';
import { Throttle } from '@nestjs/throttler';
import { IdempotencyService } from '../../common/idempotency.service';

@Controller('auctions')
export class AuctionController {
    constructor(
        private readonly auctionService: AuctionService,
        private readonly idempotencyService: IdempotencyService,
    ) {}

    // -----------------------------------
    // Place Bid (VERY SENSITIVE)
    // -----------------------------------
    @UseGuards(JwtAuthGuard)
    @Throttle({
        default: {
            limit: 10,
            ttl: 60_000, // ms
        },
    })
    @Post(':listingId/bid')
    bid(
        @Req() req: any,
        @Param('listingId') listingId: string,
        @Body() body: { amount: number },
    ) {
        return this.auctionService.placeBid(
            req.user.id,
            listingId,
            body.amount,
        );
    }

    // -----------------------------------
    // Get Auction State (Public, اما viewer رو در صورت لاگین بودن خوانده می‌شه)
    // -----------------------------------
    @UseGuards(OptionalJwtAuthGuard)
    @Get(':listingId')
    getState(@Param('listingId') listingId: string, @Req() req: any) {
        return this.auctionService.getAuctionState(listingId, req?.user?.id);
    }

    // -----------------------------------
    // Get Auction Bids (Public, اما پیشنهادهای خود کاربر با فلگ `mine`)
    // -----------------------------------
    @UseGuards(OptionalJwtAuthGuard)
    @Throttle({
        default: {
            limit: 30,
            ttl: 60_000,
        },
    })
    @Get(':listingId/bids')
    getBids(@Param('listingId') listingId: string, @Req() req: any) {
        return this.auctionService.getAuctionBids(listingId, req?.user?.id);
    }

    // -----------------------------------
    // Buy Now (EXTREMELY SENSITIVE – MONEY)
    // -----------------------------------
    @UseGuards(JwtAuthGuard)
    @Throttle({
        default: {
            limit: 3,
            ttl: 60_000,
        },
    })
    @Post(':listingId/buy-now')
    buyNow(
        @Param('listingId') listingId: string,
        @Req() req,
        @Headers('idempotency-key') key: string,
    ) {
        if (!key) {
            throw new BadRequestException('هدر Idempotency-Key الزامی است');
        }

        return this.idempotencyService.execute({
            key,
            userId: req.user.id,
            endpoint: 'BUY_NOW',
            handler: () =>
                this.auctionService.buyNow(req.user.id, listingId),
        });
    }

    // -----------------------------------
    // Pay Auction (WINNER ONLY – CRITICAL)
    // -----------------------------------
    @UseGuards(JwtAuthGuard)
    @Throttle({
        default: {
            limit: 3,
            ttl: 60_000,
        },
    })
    @Post(':listingId/pay')
    payAuction(
        @Param('listingId') listingId: string,
        @Req() req,
        @Headers('idempotency-key') key: string,
    ) {
        if (!key) {
            throw new BadRequestException('هدر Idempotency-Key الزامی است');
        }

        return this.idempotencyService.execute({
            key,
            userId: req.user.id,
            endpoint: 'AUCTION_PAY',
            handler: () =>
                this.auctionService.payAuction(req.user.id, listingId),
        });
    }
}
