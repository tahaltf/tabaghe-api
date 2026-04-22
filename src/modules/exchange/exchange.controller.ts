import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExchangeService } from './exchange.service';
import { CreateExchangeOfferDto } from './create-exchange-offer.dto';
import { FilesInterceptor } from "@nestjs/platform-express";
import { listingImagesMulterOptions } from '../../common/upload/listing-images-upload.config';

@Controller('exchange')
export class ExchangeController {
  constructor(private readonly service: ExchangeService) {}

  @UseGuards(JwtAuthGuard)
  @Post(':listingId/offers')
  @UseInterceptors(FilesInterceptor('images', 5, listingImagesMulterOptions))
  createOffer(
    @Req() req,
    @Param('listingId') listingId: string,
    @Body() dto: CreateExchangeOfferDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    return this.service.createOffer(req.user.id, listingId, dto, files);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':listingId/offers')
  getOffers(
    @Req() req,
    @Param('listingId') listingId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.service.getOffers(req.user.id, listingId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('offers/:offerId')
  getOfferById(@Req() req, @Param('offerId') offerId: string) {
    return this.service.getOfferById(req.user.id, offerId);
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