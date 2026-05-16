import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/inspection-certificate';
const ALLOWED_MIME = /^(image\/(jpe?g|png|webp|gif|svg\+xml))$/i;

/**
 * تصاویر مرتبط با گواهی کارشناسی (لوگوی بالا و مهر پایین گواهی).
 * فایل‌ها زیر /uploads/inspection-certificate/ سرو می‌شوند.
 */
export const inspectionCertificateAssetMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `cert-${randomUUID()}${extname(file.originalname)}`);
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

export const INSPECTION_CERTIFICATE_ASSET_UPLOAD_PATH = UPLOAD_PATH;
