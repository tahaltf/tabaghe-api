import {
  Controller, Patch, Body, Req, UseGuards, Get, Header,
  UseInterceptors, UploadedFile, BadRequestException
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { UsersService } from './users.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { v4 as uuidv4 } from 'uuid';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  async getMe(@Req() req: any) {
    return this.usersService.getMe(req.user.id || req.user.sub);
  }

  @Get('dashboard-stats')
  @Header('Cache-Control', 'no-store, no-cache, must-revalidate')
  @Header('Pragma', 'no-cache')
  async getDashboardStats(@Req() req: any) {
    return this.usersService.getDashboardStats(req.user.id || req.user.sub);
  }

  @Patch('complete-profile')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/national-cards';
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = uuidv4();
          cb(null, `card-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.match(/\/(jpg|jpeg|png|webp)$/)) {
          return cb(new BadRequestException('فقط فایل‌های تصویری مجاز هستند'), false);
        }
        cb(null, true);
      },
    }),
  )
  async completeProfile(
    @Req() req: any,
    @UploadedFile() file: any,
    @Body() body: any,
  ) {
    if (!file) throw new BadRequestException('تصویر کارت ملی الزامی است');
    if (!body.shabaNumber) throw new BadRequestException('شماره شبا الزامی است');

    return this.usersService.completeProfile(req.user.id || req.user.sub, {
      firstName: body.firstName,
      lastName: body.lastName,
      nationalCode: body.nationalCode,
      shabaNumber: body.shabaNumber, // 👈 دریافت شماره شبا
      nationalCardImage: file.filename, // ذخیره نام فایل به جای مسیر کامل امن‌تر است
    });
  }

  @Patch('settings')
  @UseInterceptors(
    FileInterceptor('nationalCardImage', {
      storage: diskStorage({
        destination: (req, file, cb) => {
          const uploadPath = './uploads/national-cards';
          if (!existsSync(uploadPath)) mkdirSync(uploadPath, { recursive: true });
          cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
          const uniqueSuffix = uuidv4();
          cb(null, `card-${uniqueSuffix}${extname(file.originalname)}`);
        },
      }),
    }),
  )
  async updateSettings(
    @Req() req: any,
    @Body() dto: UpdateSettingsDto,
    @UploadedFile() file?: any,
  ) {
    if (file) dto.nationalCardImage = file.filename;
    return this.usersService.updateSettings(req.user.id || req.user.sub, dto);
  }
}