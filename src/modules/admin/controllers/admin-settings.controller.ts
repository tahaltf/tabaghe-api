import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminSettingsService } from '../services/admin-settings.service';
import { BulkUpsertSettingsDto, UpsertSettingDto } from '../dto/admin-setting.dto';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSettingsController {
  constructor(private readonly service: AdminSettingsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('site-config')
  siteConfig() {
    return this.service.getSiteConfig();
  }

  @Put()
  upsert(@Body() dto: UpsertSettingDto) {
    return this.service.upsert(dto);
  }

  @Put('bulk')
  upsertMany(@Body() dto: BulkUpsertSettingsDto) {
    return this.service.upsertMany(dto);
  }

  @Post('banner')
  @UseInterceptors(FileInterceptor('banner', bannerMulterOptions))
  async uploadBanner(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setBanner(file.filename);
  }

  @Delete('banner')
  removeBanner() {
    return this.service.removeBanner();
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
