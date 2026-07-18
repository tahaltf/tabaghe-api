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
import { Throttle } from '@nestjs/throttler';
import { FilesInterceptor } from '@nestjs/platform-express';
import { IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { listingImagesMulterOptions } from '../../common/upload/listing-images-upload.config';
import { processListingImageUploads } from '../../common/upload/listing-image-process.util';
import { CacheControl } from '../../common/decorators/cache-control.decorator';
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
import { resolveGalleryFromOrder } from './utils/resolve-gallery-order.util';
import { ListingCommandService } from './services/listing-command.service';
import { ListingQueryService } from './services/listing-query.service';
import { ListingSavedService } from './services/listing-saved.service';
import { ListingAnalyticsService } from '../analytics/listing-analytics.service';

class RecordViewDto {
  @IsOptional()
  @IsString()
  sessionId?: string;
}

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
    private readonly analyticsService: ListingAnalyticsService,
  ) {}

  @Get()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @CacheControl('public, max-age=30, stale-while-revalidate=60')
  findAll(@Query() query: ListListingsDto) {
    return this.queryService.findAll(query);
  }

  @Get('suggest')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @CacheControl('public, max-age=30, stale-while-revalidate=60')
  suggest(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('types') types?: string,
  ) {
    const parsed = limit ? Number(limit) : 8;
    return this.queryService.suggest(
      q ?? '',
      Number.isFinite(parsed) ? parsed : 8,
      types,
    );
  }

  @Get('home-feed')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @CacheControl('public, max-age=30, stale-while-revalidate=60')
  getHomeFeed(@Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 10;
    return this.queryService.getHomeFeed(
      Number.isFinite(parsed) ? parsed : 10,
    );
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

  @UseGuards(OptionalJwtAuthGuard)
  @Get(':id/availability')
  async checkAvailability(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
  ) {
    const available = await this.queryService.checkAvailability(id, user?.id);
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
  @Post(':id/view')
  async recordView(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser | null,
    @Body() body: RecordViewDto,
  ) {
    await this.analyticsService.recordView(id, user?.id, body.sessionId);
    return { ok: true };
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
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateListingDto,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const fileNames = await processListingImageUploads(files);
    let gallery = fileNames;
    let thumbnail = fileNames[0] ?? dto.thumbnail;
    if (dto.galleryOrder?.length && fileNames.length > 0) {
      const resolved = resolveGalleryFromOrder(dto.galleryOrder, fileNames);
      gallery = resolved.gallery;
      thumbnail = resolved.thumbnail ?? thumbnail;
    }
    const { galleryOrder: _galleryOrder, ...restDto } = dto;
    const finalDto: CreateListingDto = {
      ...restDto,
      gallery,
      thumbnail,
    };
    return this.commandService.create(user.id, finalDto);
  }

  @UseGuards(JwtAuthGuard, IsVerifiedGuard)
  @Patch(':id')
  @UseInterceptors(FilesInterceptor('images', 10, listingImagesMulterOptions))
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateListingDto,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    const { galleryOrder, ...restDto } = dto;
    const payload: UpdateListingDto = { ...restDto };
    if (files?.length) {
      const fileNames = await processListingImageUploads(files);
      if (galleryOrder?.length) {
        const resolved = resolveGalleryFromOrder(galleryOrder, fileNames);
        payload.gallery = resolved.gallery;
        payload.thumbnail = resolved.thumbnail ?? undefined;
      } else {
        payload.gallery = fileNames;
        payload.thumbnail = dto.thumbnail ?? fileNames[0];
      }
    } else if (dto.gallery?.length) {
      payload.thumbnail = dto.thumbnail ?? dto.gallery[0];
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
