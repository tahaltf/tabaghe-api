import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/national-cards';
const ALLOWED_MIME_REGEX = /\/(jpg|jpeg|png|webp)$/;

export const nationalCardMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `card-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فقط فایل‌های تصویری (jpg, png, webp) مجاز هستند',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
};
