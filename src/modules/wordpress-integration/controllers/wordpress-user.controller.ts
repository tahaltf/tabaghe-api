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
import { existsSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { WordPressApiTokenService } from '../services/api-token.service';
import { WordPressConnectionService } from '../services/connection.service';
import { CreateWordPressTokenDto } from '../dto/create-wordpress-token.dto';

@Controller('integrations/wordpress')
@UseGuards(JwtAuthGuard)
export class WordPressUserController {
  constructor(
    private readonly tokenService: WordPressApiTokenService,
    private readonly connectionService: WordPressConnectionService,
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
  pluginDownload(@Res() res: Response) {
    const zipPath = join(process.cwd(), 'uploads', 'downloads', 'tabaghe-sync.zip');
    if (!existsSync(zipPath)) {
      return res.status(404).json({
        success: false,
        message: 'فایل افزونه هنوز آماده نشده است',
      });
    }
    return res.download(zipPath, 'tabaghe-sync.zip');
  }
}
