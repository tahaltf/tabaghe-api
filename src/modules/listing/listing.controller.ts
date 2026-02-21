import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ListingService } from './listing.service';
import { AuctionService } from '../auction/auction.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, ListingStatus } from '@prisma/client';
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { v4 as uuidv4 } from 'uuid';

@Controller('listings')
export class ListingController {
  constructor(
    private readonly listingService: ListingService,
    private readonly auctionService: AuctionService
  ) {}

  @Get()
  findAll(@Query() query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    return this.listingService.findAll(query, page, limit);
  }

  @UseGuards(JwtAuthGuard)
  @Get('my-listings')
  findMyListings(@Req() req: any) {
    return this.listingService.findAllByUser(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('saved')
  async getSavedListings(@Req() req: any) {
    return this.listingService.getSavedListings(req.user.id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/all')
  findAllAdmin(@Query('status') status?: ListingStatus) {
    return this.listingService.findAllForAdmin(status);
  }

  @Get(':id/availability')
  checkAvailability(@Param('id') id: string) {
    return this.listingService.checkAvailability(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/is-saved')
  async checkIsSaved(@Param('id') id: string, @Req() req: any) {
    return this.listingService.isListingSaved(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('exchange-offer/:id')
  getExchangeOffer(@Param('id') id: string, @Req() req: any) {
    return this.listingService.getExchangeOffer(id, req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/auction-checkout')
  getAuctionCheckout(@Param('id') id: string, @Req() req: any) {
    return this.listingService.getAuctionCheckoutData(id, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listingService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/save')
  async toggleSave(@Param('id') id: string, @Req() req: any) {
    return this.listingService.toggleSave(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/bid')
  async placeBid( // 👈 کلمه async برای بررسی صاحب آگهی اضافه شد
    @Req() req: any,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('مبلغ پیشنهادی معتبر نیست');
    }

    // 🛡️ بررسی امنیتی: صاحب آگهی حق شرکت در مزایده خود را ندارد
    const listing = await this.listingService.findOne(id);
    if (listing.authorId === req.user.id) {
      throw new ForbiddenException('شما نمی‌توانید در مزایده آگهی خودتان شرکت کنید');
    }

    return this.auctionService.placeBid(req.user.id, id, amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('exchange-offer')
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = './uploads/listings';
        if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
        cb(null, uploadPath);
      },
      filename: (req, file, callback) => {
        const uniqueSuffix = uuidv4();
        const ext = extname(file.originalname);
        callback(null, `${uniqueSuffix}${ext}`);
      },
    }),
    fileFilter: (req, file, callback) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        return callback(new BadRequestException('فرمت عکس نامعتبر است'), false);
      }
      callback(null, true);
    }
  }))
  async createExchangeOffer(
    @CurrentUser() user: any,
    @Body() dto: any,
    @UploadedFiles() files: Array<Express.Multer.File>
  ) {
    return this.listingService.createExchangeOffer(user.id, dto, files);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(
    FilesInterceptor('images', 10, { // ✅ هماهنگ با 'images' فرانت
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/listings';
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new BadRequestException('فرمت عکس نامعتبر است'), false);
        }
        cb(null, true);
      },
    }),
  )
  async create(
    @Req() req: any,
    @Body() dto: any,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    const fileNames = files ? files.map((file) => file.filename) : [];
    const finalDto = {
      ...dto,
      gallery: fileNames,
      thumbnail: fileNames.length > 0 ? fileNames[0] : null,
    };

    return this.listingService.create(req.user.id, finalDto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @UseInterceptors(
    FilesInterceptor('images', 10, { // ✅ هماهنگ با 'images' فرانت
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/listings';
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
    @UploadedFiles() files?: Array<Express.Multer.File>,
  ) {
    if (files && files.length > 0) {
      const fileNames = files.map((file) => file.filename);
      dto.gallery = fileNames;
      dto.thumbnail = fileNames[0];
    }

    return this.listingService.update(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  delete(@Req() req: any, @Param('id') id: string, @Body() dto: any) {
    return this.listingService.delete(req.user.id, id, dto);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/approve')
  approve(@Param('id') id: string, @Req() req: any) {
    return this.listingService.approve(id, req.user.role);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.listingService.reject(id, req.user.role, dto);
  }
}