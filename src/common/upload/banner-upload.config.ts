import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/banners';
const ALLOWED_MIME_REGEX = /\/(jpg|jpeg|png|webp|gif)$/;

/**
 * Multer options for homepage / dashboard banner images uploaded by admin.
 * Files are stored under `/uploads/banners/` and served as static assets.
 */
export const bannerMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `banner-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException('فقط فایل‌های تصویری (jpg, png, webp, gif) مجاز هستند'),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 8 * 1024 * 1024 },
};

export const BANNER_UPLOAD_PATH = UPLOAD_PATH;
