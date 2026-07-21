import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../../auth/guards/is-verified.guard';
import { UserPanelAccessGuard } from '../../auth/guards/user-panel-access.guard';
import { RequirePanelAccess } from '../../auth/decorators/require-panel-access.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { WordPressApiTokenService } from '../services/api-token.service';
import { WordPressConnectionService } from '../services/connection.service';
import { WordPressPluginPackageService } from '../services/plugin-package.service';
import { WordPressStoreSyncService } from '../services/store-sync.service';
import { CreateWordPressTokenDto } from '../dto/create-wordpress-token.dto';

@Controller('integrations/wordpress')
@UseGuards(JwtAuthGuard)
export class WordPressUserController {
  constructor(
    private readonly tokenService: WordPressApiTokenService,
    private readonly connectionService: WordPressConnectionService,
    private readonly pluginPackageService: WordPressPluginPackageService,
    private readonly storeSyncService: WordPressStoreSyncService,
  ) {}

  @Post('tokens')
  @UseGuards(IsVerifiedGuard, UserPanelAccessGuard)
  @RequirePanelAccess('settings.wordpress')
  createToken(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateWordPressTokenDto,
  ) {
    return this.tokenService.generate(user.id, dto.name ?? 'default');
  }

  @Get('tokens')
  listTokens(@CurrentUser() user: AuthenticatedUser) {
    return this.tokenService.listActive(user.id);
  }

  @Delete('tokens/:id')
  revokeToken(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.tokenService.revoke(user.id, id);
  }

  @Get('connection')
  connectionStatus(@CurrentUser() user: AuthenticatedUser) {
    return this.connectionService.getStatus(user.id);
  }

  @Get('listings')
  listImportedListings(@CurrentUser() user: AuthenticatedUser) {
    return this.storeSyncService.listImportedListings(user.id);
  }

  @Post('sync-store')
  @UseGuards(IsVerifiedGuard, UserPanelAccessGuard)
  @RequirePanelAccess('settings.wordpress')
  syncFromStore(@CurrentUser() user: AuthenticatedUser) {
    return this.storeSyncService.syncFromStore(user.id);
  }

  @Get('plugin-download')
  async pluginDownload(@Res() res: Response) {
    try {
      await this.pluginPackageService.ensurePackageReady();
    } catch {
      return res.status(404).json({
        success: false,
        message: 'فایل افزونه هنوز آپلود نشده است. از پنل ادمین آپلود کنید.',
      });
    }

    return res.download(
      this.pluginPackageService.getZipPath(),
      'tabagheh-sync.zip',
    );
  }

  @Get('plugin-info')
  pluginInfo() {
    return this.pluginPackageService.getStatus();
  }
}
