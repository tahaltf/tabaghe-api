import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { join } from 'path';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const WORDPRESS_PLUGIN_ZIP_NAME = 'tabagheh-sync.zip';
const MAX_PLUGIN_ZIP_BYTES = 50 * 1024 * 1024;

export function resolveWordPressPluginUploadDir(): string {
  return join(process.cwd(), 'uploads', 'downloads');
}

export const wordpressPluginMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = resolveWordPressPluginUploadDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (_req, _file, cb) => {
      cb(null, WORDPRESS_PLUGIN_ZIP_NAME);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.zip')) {
      return cb(new BadRequestException('فقط فایل ZIP مجاز است'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_PLUGIN_ZIP_BYTES },
};
