import {
    Body,
    Controller,
    Get,
    Param,
    Post,
    Req,
    UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExchangeService } from './exchange.service';
import {CreateExchangeOfferDto} from "./create-exchange-offer.dto";

@Controller('exchange')
export class ExchangeController {
    constructor(private readonly service: ExchangeService) {}

    @UseGuards(JwtAuthGuard)
    @Post(':listingId/offers')
    createOffer(
        @Req() req,
        @Param('listingId') listingId: string,
        @Body() dto: CreateExchangeOfferDto,
    ) {
        return this.service.createOffer(req.user.id, listingId, dto);
    }

    @UseGuards(JwtAuthGuard)
    @Get(':listingId/offers')
    getOffers(@Req() req, @Param('listingId') listingId: string) {
        return this.service.getOffers(req.user.id, listingId);
    }

    @UseGuards(JwtAuthGuard)
    @Post('offers/:offerId/accept')
    accept(@Req() req, @Param('offerId') offerId: string) {
        return this.service.acceptOffer(req.user.id, offerId);
    }

    @UseGuards(JwtAuthGuard)
    @Post('offers/:offerId/reject')
    reject(@Req() req, @Param('offerId') offerId: string) {
        return this.service.rejectOffer(req.user.id, offerId);
    }
}
