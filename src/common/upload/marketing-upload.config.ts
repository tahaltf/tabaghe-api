import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const MARKETING_UPLOAD_PATH = './uploads/marketing';

const ALLOWED_MIME =
  /\/(jpg|jpeg|png|webp|gif|mp4|quicktime|x-m4v)$/;

export const marketingMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(MARKETING_UPLOAD_PATH)) {
        mkdirSync(MARKETING_UPLOAD_PATH, { recursive: true });
      }
      cb(null, MARKETING_UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `mkt-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فقط تصویر (jpg/png/webp/gif) یا ویدیو (mp4/mov) مجاز است؛ حداکثر ۱۰۰ مگابایت.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 100 * 1024 * 1024 },
};
