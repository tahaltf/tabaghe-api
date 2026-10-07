import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { AppSettingsService } from '../../../shared/settings/app-settings.service';
import { ServerSecretConfigService } from '../../../shared/settings/server-secret-config.service';
import { WordPressPluginPackageService } from '../services/plugin-package.service';

/**
 * Public endpoints so WordPress Plugin_Upgrader can fetch the zip
 * without Authorization headers (core download_url is unauthenticated).
 */
@Controller('integrations/wordpress/plugin')
export class WordPressPluginPublicController {
  constructor(
    private readonly pluginPackageService: WordPressPluginPackageService,
    private readonly appSettings: AppSettingsService,
    private readonly secrets: ServerSecretConfigService,
  ) {}

  private resolveApiV1Base(): string {
    const root = (
      this.secrets.get('API_PUBLIC_URL') ||
      this.appSettings.getApiUrl() ||
      'https://api.tabagheh.com'
    ).replace(/\/$/, '');
    return root.endsWith('/api/v1') ? root : `${root}/api/v1`;
  }

  @Get('latest')
  async latest() {
    return this.pluginPackageService.getUpdateManifest(this.resolveApiV1Base());
  }

  @Get('download')
  async download(@Res() res: Response) {
    try {
      await this.pluginPackageService.ensurePackageReady();
    } catch {
      return res.status(404).json({
        success: false,
        message: 'فایل افزونه هنوز منتشر نشده است.',
      });
    }

    return res.download(
      this.pluginPackageService.getZipPath(),
      'tabagheh-sync.zip',
    );
  }
}
