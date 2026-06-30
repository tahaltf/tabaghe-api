import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { wordpressPluginMulterOptions } from '../../../common/upload/wordpress-plugin-upload.config';
import { WordPressPluginPackageService } from '../services/plugin-package.service';

class UpdateWordPressPluginVersionDto {
  @IsOptional()
  @IsString()
  @MaxLength(32)
  latestVersion?: string | null;
}

@Controller('admin/wordpress-plugin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminWordPressPluginController {
  constructor(
    private readonly pluginPackageService: WordPressPluginPackageService,
  ) {}

  @Get('status')
  getStatus() {
    return this.pluginPackageService.getStatus();
  }

  @Patch('version')
  async updateVersion(@Body() dto: UpdateWordPressPluginVersionDto) {
    await this.pluginPackageService.setLatestVersion(dto.latestVersion ?? null);
    return this.pluginPackageService.getStatus();
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', wordpressPluginMulterOptions))
  async upload(@UploadedFile() file?: Express.Multer.File) {
    if (!file?.filename) {
      throw new BadRequestException('فایل ZIP افزونه ارسال نشد');
    }
    return this.pluginPackageService.getStatus();
  }
}
