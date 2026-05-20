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
import {
  BulkUpsertSettingsDto,
  UpsertSettingDto,
} from '../dto/admin-setting.dto';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { brandLogoMulterOptions } from '../../../common/upload/brand-logo-upload.config';
import { inspectionCertificateAssetMulterOptions } from '../../../common/upload/inspection-certificate-asset-upload.config';

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

  @Post('media-fallback-logo')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadMediaFallbackLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setMediaFallbackLogo(file.filename);
  }

  @Delete('media-fallback-logo')
  removeMediaFallbackLogo() {
    return this.service.removeMediaFallbackLogo();
  }

  @Post('user-logo')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadUserLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setUserAppLogo(file.filename);
  }

  @Delete('user-logo')
  removeUserLogo() {
    return this.service.removeUserAppLogo();
  }

  @Post('user-logo-light')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadUserLogoLight(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setUserAppLogoLight(file.filename);
  }

  @Delete('user-logo-light')
  removeUserLogoLight() {
    return this.service.removeUserAppLogoLight();
  }

  @Post('user-logo-dark')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadUserLogoDark(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setUserAppLogoDark(file.filename);
  }

  @Delete('user-logo-dark')
  removeUserLogoDark() {
    return this.service.removeUserAppLogoDark();
  }

  @Post('admin-logo')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadAdminLogo(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setAdminPanelLogo(file.filename);
  }

  @Delete('admin-logo')
  removeAdminLogo() {
    return this.service.removeAdminPanelLogo();
  }

  @Post('inspection-certificate-logo')
  @UseInterceptors(
    FileInterceptor('file', inspectionCertificateAssetMulterOptions),
  )
  async uploadInspectionCertificateLogo(
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setInspectionCertificateLogo(file.filename);
  }

  @Delete('inspection-certificate-logo')
  removeInspectionCertificateLogo() {
    return this.service.removeInspectionCertificateLogo();
  }

  @Post('inspection-certificate-stamp')
  @UseInterceptors(
    FileInterceptor('file', inspectionCertificateAssetMulterOptions),
  )
  async uploadInspectionCertificateStamp(
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setInspectionCertificateStamp(file.filename);
  }

  @Delete('inspection-certificate-stamp')
  removeInspectionCertificateStamp() {
    return this.service.removeInspectionCertificateStamp();
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
