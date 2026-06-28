import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import { join } from 'path';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { FilesService } from './files.service';

const PROTECTED_CATEGORIES = new Set([
  'national-cards',
  'tickets',
  'deposit-receipts',
]);

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':category/:filename')
  async serveProtectedFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category') category: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ) {
    if (!PROTECTED_CATEGORIES.has(category)) {
      throw new NotFoundException('فایل یافت نشد.');
    }

    const safeName = filename.replace(/[/\\]/g, '');
    if (!safeName || safeName !== filename) {
      throw new NotFoundException('فایل یافت نشد.');
    }

    const allowed = await this.filesService.canAccessFile(user, category, safeName);
    if (!allowed) {
      throw new ForbiddenException('دسترسی به این فایل مجاز نیست.');
    }

    const filePath = join(process.cwd(), 'uploads', category, safeName);
    if (!existsSync(filePath)) {
      throw new NotFoundException('فایل یافت نشد.');
    }

    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(filePath).pipe(res);
  }
}
