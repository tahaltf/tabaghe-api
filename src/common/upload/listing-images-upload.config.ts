import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { LISTING_UPLOAD_DIR } from './listing-image-process.util';

const ALLOWED_MIME_REGEX = /\/(jpg|jpeg|png|gif|webp)$/;
/** Hard cap before sharp compression (plan: 3–5MB). */
const MAX_BYTES = 5 * 1024 * 1024;

export const listingImagesMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(LISTING_UPLOAD_DIR)) {
        mkdirSync(LISTING_UPLOAD_DIR, { recursive: true });
      }
      cb(null, LISTING_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فرمت عکس نامعتبر است. فقط jpg، png، gif یا webp تا حداکثر ۵ مگابایت مجاز است.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_BYTES },
};
