import {
  Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards,
  UseInterceptors, UploadedFiles, BadRequestException
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { ListingService } from './listing.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { UserRole, ListingStatus } from '@prisma/client';

@Controller(['listings', 'ads'])
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

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

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  @Get('admin/all')
  findAllAdmin(@Query('status') status?: ListingStatus) {
    return this.listingService.findAllForAdmin(status);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.listingService.findOne(id);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  @UseInterceptors(FilesInterceptor('files', 10, {
    storage: diskStorage({
      destination: './uploads/listings',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
        return cb(new BadRequestException('فقط فایل‌های تصویری مجاز هستند'), false);
      }
      cb(null, true);
    }
  }))
  async create(
    @Req() req: any,
    @Body() dto: any, // تغییر به any برای هندل کردن دیتای FormData
    @UploadedFiles() files: Array<Express.Multer.File>
  ) {
    if (files && files.length > 0) {
      const fileNames = files.map(file => file.filename);
      dto.gallery = fileNames;
      dto.thumbnail = fileNames[0];
    }
    return this.listingService.create(req.user.id, dto);
  }

  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  @UseInterceptors(FilesInterceptor('files', 10, { // قابلیت آپلود عکس در ویرایش
    storage: diskStorage({
      destination: './uploads/listings',
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
        cb(null, `${uniqueSuffix}${extname(file.originalname)}`);
      },
    }),
  }))
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: any,
    @UploadedFiles() files?: Array<Express.Multer.File>
  ) {
    if (files && files.length > 0) {
      const fileNames = files.map(file => file.filename);
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