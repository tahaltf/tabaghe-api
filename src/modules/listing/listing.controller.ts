import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { listingImagesMulterOptions } from '../../common/upload/listing-images-upload.config';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { AuctionService } from '../auction/auction.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsVerifiedGuard } from '../auth/guards/is-verified.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../auth/guards/optional-jwt-auth.guard';
import { CreateListingDto } from './dto/create-listing.dto';
import { DeleteListingDto } from './dto/delete-listing.dto';
import { ListListingsDto } from './dto/list-listings.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import { ListingCommandService } from './services/listing-command.service';
import { ListingQueryService } from './services/listing-query.service';
import { ListingSavedService } from './services/listing-saved.service';

class PlaceBidDto {
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  amount!: number;
}

@Controller('listings')
export class ListingController {
  constructor(
    private readonly queryService: ListingQueryService,
    private readonly commandService: ListingCommandService,
    private readonly savedService: ListingSavedService,
    private readonly auctionService: AuctionService,
  ) {}

  @Get()
  findAll(@Query() query: ListListingsDto) {
    return this.queryService.findAll(query);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-listings')
  findMyListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.queryService.findAllByUser(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @UseGuards(JwtAuthGuard)
  @Get('saved')
  getSavedListings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.savedService.listForUser(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get(':id/availability')
  async checkAvailability(@Param('id') id: string) {
    const available = await this.queryService.checkAvailability(id);
    return { available };
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/is-saved')
  checkIsSaved(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.savedService.isSaved(user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/auction-checkout')
  getAuctionCheckout(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.auctionService.getAuctionCheckoutData(id, user.id);
  }

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    return this.queryService.findOne(id, user?.id, user?.role);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/save')
  toggleSave(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.savedService.toggle(user.id, id);
  }

  @UseGuards(JwtAuthGuard, IsVerifiedGuard)
  @Post(':id/bid')
  async placeBid(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: PlaceBidDto,
  ) {
    const listing = await this.queryService.findOne(id);
    if (listing.authorId === user.id) {
      throw new ForbiddenException(
        'شما نمی‌توانید در مزایده آگهی خودتان شرکت کنید',
      );
    }
    return this.auctionService.placeBid(user.id, id, body.amount);
  }

  @UseGuards(JwtAuthGuard, IsVerifiedGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('images', 10, listingImagesMulterOptions))
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const fileNames = files?.map((f) => f.filename) ?? [];
    const finalDto: CreateListingDto = {
      ...dto,
      gallery: fileNames,
      thumbnail: fileNames[0] ?? dto.thumbnail,
    };
    return this.commandService.create(user.id, finalDto);
  }

  @UseGuards(JwtAuthGuard, IsVerifiedGuard)
  @Patch(':id')
  @UseInterceptors(FilesInterceptor('images', 10, listingImagesMulterOptions))
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    const payload: UpdateListingDto = { ...dto };
    if (files?.length) {
      const fileNames = files.map((f) => f.filename);
      payload.gallery = fileNames;
      payload.thumbnail = fileNames[0];
    }
    return this.commandService.update(user.id, id, payload);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DeleteListingDto,
  ) {
    return this.commandService.softDelete(user.id, id, dto);
  }
}
