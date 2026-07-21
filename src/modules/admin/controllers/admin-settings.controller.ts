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
import { Throttle } from '@nestjs/throttler';
import { FileInterceptor } from '@nestjs/platform-express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { AdminSettingsService } from '../services/admin-settings.service';
import { AdminSecretKeysService } from '../services/admin-secret-keys.service';
import {
  BulkUpsertSettingsDto,
  UpsertSettingDto,
} from '../dto/admin-setting.dto';
import { SetAdminSecretDto } from '../dto/admin-secret.dto';
import { bannerMulterOptions } from '../../../common/upload/banner-upload.config';
import { brandLogoMulterOptions } from '../../../common/upload/brand-logo-upload.config';
import { inspectionCertificateAssetMulterOptions } from '../../../common/upload/inspection-certificate-asset-upload.config';
import { SmsService } from '../../sms/sms.service';

@Controller('admin/settings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('settings.view')
export class AdminSettingsController {
  constructor(
    private readonly service: AdminSettingsService,
    private readonly secretKeys: AdminSecretKeysService,
    private readonly sms: SmsService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get('site-config')
  siteConfig() {
    return this.service.getSiteConfig();
  }

  @Put()
  @RequirePermission('settings.update')
  upsert(@Body() dto: UpsertSettingDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.service.upsert(dto, actor);
  }

  @Put('bulk')
  @RequirePermission('settings.update')
  upsertMany(
    @Body() dto: BulkUpsertSettingsDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.upsertMany(dto, actor);
  }

  @Post('banner')
  @RequirePermission('settings.update')
  @UseInterceptors(FileInterceptor('banner', bannerMulterOptions))
  async uploadBanner(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setBanner(file.filename);
  }

  @Delete('banner')
  @RequirePermission('settings.update')
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

  @Post('pwa-app-icon')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadPwaAppIcon(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setPwaAppIcon(file.filename);
  }

  @Delete('pwa-app-icon')
  removePwaAppIcon() {
    return this.service.removePwaAppIcon();
  }

  @Post('pwa-favicon')
  @UseInterceptors(FileInterceptor('file', brandLogoMulterOptions))
  async uploadPwaFavicon(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('فایلی ارسال نشده است');
    return this.service.setPwaAppFavicon(file.filename);
  }

  @Delete('pwa-favicon')
  removePwaFavicon() {
    return this.service.removePwaAppFavicon();
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

  @Get('homepage-layout')
  @RequirePermission('homepage.view')
  homepageLayout() {
    return this.service.getHomepageLayout();
  }

  @Put('homepage-layout')
  @RequirePermission('homepage.update')
  upsertHomepageLayout(
    @Body() body: { layout: unknown },
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const layout = body?.layout ?? body;
    return this.service.upsertHomepageLayout(layout as never, actor);
  }

  @Delete('homepage-layout')
  @RequirePermission('homepage.update')
  resetHomepageLayout(@CurrentUser() actor: AuthenticatedUser) {
    return this.service.resetHomepageLayout(actor);
  }

  /**
   * ارسال آزمایشی SMS نتیجه دیپلوی با تنظیمات پنل (گیرنده/قالب/کلید).
   */
  @Post('test-deploy-sms')
  @RequirePermission('settings.update')
  async testDeploySms() {
    const result = await this.sms.sendDeployAlert(
      'تست',
      'ارسال آزمایشی از پنل',
    );
    return { ok: result.sent > 0, ...result };
  }

  @Get('secrets/catalog')
  @RequirePermission('settings_secrets.view')
  secretCatalog() {
    return this.secretKeys.getCatalog();
  }

  @Get('secrets')
  @RequirePermission('settings_secrets.view')
  listSecrets(@CurrentUser() actor: AuthenticatedUser) {
    return this.secretKeys.list(actor);
  }

  @Put('secrets/:key')
  @RequirePermission('settings_secrets.update')
  setSecret(
    @Param('key') key: string,
    @Body() dto: SetAdminSecretDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.secretKeys.set(key, dto.value, actor);
  }

  @Delete('secrets/:key')
  @RequirePermission('settings_secrets.update')
  clearSecret(
    @Param('key') key: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.secretKeys.clear(key, actor);
  }

  @Post('secrets/:key/reveal')
  @Roles(UserRole.GODADMIN)
  @RequirePermission('settings_secrets.view')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  revealSecret(
    @Param('key') key: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.secretKeys.reveal(key, actor);
  }

  @Delete(':key')
  remove(@Param('key') key: string) {
    return this.service.remove(key);
  }
}
