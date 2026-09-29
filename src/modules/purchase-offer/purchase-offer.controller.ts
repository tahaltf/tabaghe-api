import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PurchaseOfferService } from './purchase-offer.service';
import {
  CreatePurchaseOfferDto,
  RejectPurchaseOfferDto,
} from './purchase-offer.dto';

@Controller('purchase-offers')
export class PurchaseOfferController {
  constructor(private readonly service: PurchaseOfferService) {}

  @UseGuards(JwtAuthGuard)
  @Post('item/:offerId/accept')
  accept(
    @Req() req: { user: { id: string } },
    @Param('offerId') offerId: string,
  ) {
    return this.service.acceptOffer(req.user.id, offerId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('item/:offerId/reject')
  reject(
    @Req() req: { user: { id: string } },
    @Param('offerId') offerId: string,
    @Body() dto: RejectPurchaseOfferDto,
  ) {
    return this.service.rejectOffer(req.user.id, offerId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':listingId/mine')
  getMyOffer(
    @Req() req: { user: { id: string } },
    @Param('listingId') listingId: string,
  ) {
    return this.service.getMyOffer(req.user.id, listingId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':listingId')
  createOffer(
    @Req() req: { user: { id: string } },
    @Param('listingId') listingId: string,
    @Body() dto: CreatePurchaseOfferDto,
  ) {
    return this.service.createOffer(req.user.id, listingId, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':listingId')
  getOffers(
    @Req() req: { user: { id: string } },
    @Param('listingId') listingId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getOffers(req.user.id, listingId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }
}
