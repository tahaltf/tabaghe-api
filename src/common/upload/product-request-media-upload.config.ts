import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const IMAGE_PATH = './uploads/product-requests/images';
const IMAGE_MIME = /\/(jpg|jpeg|png|webp|gif)$/;

const ensure = (path: string) => {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
};

export const productRequestMediaMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      ensure(IMAGE_PATH);
      cb(null, IMAGE_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `pr-img-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!IMAGE_MIME.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فقط تصویر jpg، png، webp یا gif مجاز است؛ حداکثر حجم هر تصویر ۱۰ مگابایت.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 10 * 1024 * 1024 },
};

export const PRODUCT_REQUEST_IMAGE_SUBDIR = 'product-requests/images';
