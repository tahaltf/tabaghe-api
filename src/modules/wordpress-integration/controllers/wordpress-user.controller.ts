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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { WordPressApiTokenService } from '../services/api-token.service';
import { WordPressConnectionService } from '../services/connection.service';
import { WordPressPluginPackageService } from '../services/plugin-package.service';
import { CreateWordPressTokenDto } from '../dto/create-wordpress-token.dto';

@Controller('integrations/wordpress')
@UseGuards(JwtAuthGuard)
export class WordPressUserController {
  constructor(
    private readonly tokenService: WordPressApiTokenService,
    private readonly connectionService: WordPressConnectionService,
    private readonly pluginPackageService: WordPressPluginPackageService,
  ) {}

  @Post('tokens')
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
      'tabaghe-sync.zip',
    );
  }
}
