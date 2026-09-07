import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/brand';
/** jpg ممکن است به‌صورت image/jpg ارسال شود */
const ALLOWED_MIME = /^(image\/(jpe?g|png|webp|gif|svg\+xml))$/i;

/**
 * تصویر لوگوی جایگزین وقتی تصویر آگهی لود نمی‌شود (تنظیم ادمین).
 * زیر /uploads/brand/ سرو می‌شود.
 */
export const brandLogoMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `media-fallback-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فقط فایل‌های تصویری jpg، png، webp، gif یا svg مجازند؛ حداکثر حجم ۲ مگابایت.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 2 * 1024 * 1024 },
};

export const BRAND_LOGO_UPLOAD_PATH = UPLOAD_PATH;

/** آیکن مجوزهای فوتر — همان پوشه brand */
export const licenseIconMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `license-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: brandLogoMulterOptions.fileFilter,
  limits: { fileSize: 2 * 1024 * 1024 },
};
