import {
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'fs';
import { join, extname } from 'path';
import { RawResponse } from '../../common/decorators/raw-response.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { FilesService } from './files.service';

const PROTECTED_CATEGORIES = new Set([
  'national-cards',
  'tickets',
  'deposit-receipts',
]);

function contentTypeFromFilename(filename: string): string {
  const ext = extname(filename).toLowerCase();
  switch (ext) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @Get(':category/:filename')
  @RawResponse()
  async serveProtectedFile(
    @CurrentUser() user: AuthenticatedUser,
    @Param('category') category: string,
    @Param('filename') filename: string,
  ): Promise<StreamableFile> {
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

    const contentType = contentTypeFromFilename(safeName);
    return new StreamableFile(createReadStream(filePath), {
      type: contentType,
      disposition: `inline; filename="${safeName}"`,
    });
  }
}
