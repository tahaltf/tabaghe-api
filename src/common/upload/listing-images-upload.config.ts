import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/listings';
const ALLOWED_MIME_REGEX = /\/(jpg|jpeg|png|gif|webp)$/;

export const listingImagesMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فرمت عکس نامعتبر است. فقط jpg، png، gif یا webp تا حداکثر ۱۰ مگابایت مجاز است.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};
