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
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { ListingService } from './listing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, ListingStatus } from '@prisma/client';
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { v4 as uuidv4 } from 'uuid';

@Controller('listings') // فقط listings کافیست، ads را اگر نیاز نیست حذف کن
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  // ======================================================
  // 1. PUBLIC GET ENDPOINTS (Static Routes First)
  // ======================================================

  @Get()
  findAll(@Query() query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    return this.listingService.findAll(query, page, limit);
  }

  // ======================================================
  // 2. USER SPECIFIC ROUTES (Static Routes First)
  // ======================================================

  @UseGuards(JwtAuthGuard)
  @Get('my-listings')
  findMyListings(@Req() req: any) {
    return this.listingService.findAllByUser(req.user.id);
  }

  // ✅ اصلاح مسیر به 'saved' تا با درخواست فرانت مچ شود
  // ✅ این متد حتماً باید قبل از Get(':id') باشد
  @UseGuards(JwtAuthGuard)
  @Get('saved')
  async getSavedListings(@Req() req) {
    return this.listingService.getSavedListings(req.user.id);
  }

  // ======================================================
  // 3. ADMIN ROUTES (Static Routes First)
  // ======================================================

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/all')
  findAllAdmin(@Query('status') status?: ListingStatus) {
    return this.listingService.findAllForAdmin(status);
  }

  // ======================================================
  // 4. DYNAMIC GET ENDPOINTS (Dynamic Routes :id Last)
  // ======================================================

  @Get(':id/availability')
  checkAvailability(@Param('id') id: string) {
    return this.listingService.checkAvailability(id);
  }

  @UseGuards(JwtAuthGuard)
  @Get(':id/is-saved')
  async checkIsSaved(@Param('id') id: string, @Req() req) {
    return this.listingService.isListingSaved(req.user.id, id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listingService.findOne(id);
  }

  // ======================================================
  // 5. POST / PATCH / DELETE ACTION ENDPOINTS
  // ======================================================

  @UseGuards(JwtAuthGuard)
  @Post(':id/save')
  async toggleSave(@Param('id') id: string, @Req() req) {
    return this.listingService.toggleSave(req.user.id, id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/bid')
  placeBid(
    @Req() req: any,
    @Param('id') id: string,
    @Body('amount') amount: number,
  ) {
    if (!amount || amount <= 0) {
      throw new BadRequestException('مبلغ پیشنهادی معتبر نیست');
    }
    return this.listingService.placeBid(req.user.id, id, amount);
  }

  @UseGuards(JwtAuthGuard)
  @Post('exchange-offer')
  @UseInterceptors(FilesInterceptor('images', 5, {
    storage: diskStorage({
      destination: (req, file, cb) => {
        const uploadPath = './uploads/listings';
        if (!existsSync(uploadPath)) {
          mkdirSync(uploadPath, { recursive: true });
        }
        cb(null, uploadPath);
      },
      filename: (req, file, callback) => {
        const uniqueSuffix = uuidv4();
        const ext = extname(file.originalname);
        const filename = `${uniqueSuffix}${ext}`;
        callback(null, filename);
      },
    }),
    fileFilter: (req, file, callback) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|gif|webp)$/)) {
        return callback(new BadRequestException('Only image files are allowed!'), false);
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
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/listings';
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
          cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(
            new BadRequestException('فقط فایل‌های تصویری مجاز هستند'),
            false,
          );
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
    FilesInterceptor('files', 10, {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/listings';
          if (!existsSync(uploadPath)) {
            mkdirSync(uploadPath, { recursive: true });
          }
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix =
            Date.now() + '-' + Math.round(Math.random() * 1e9);
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

  // ======================================================
  // 6. ADMIN ACTIONS
  // ======================================================

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