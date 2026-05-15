import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

export const ORDER_VIDEO_UPLOAD_DIR = './uploads/orders/videos';
export const ORDER_SHIPPING_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const ORDER_SHIPPING_VIDEO_MAX_LABEL = '۵۰ مگابایت';

const VIDEO_MIME =
  /\/(mp4|mov|quicktime|x-msvideo|mpeg|webm|3gpp|3gp|x-matroska)$/;

const ensureDir = (path: string) => {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
};

/** ویدیوی بسته‌بندی/ارسال سفارش (فروش مستقیم و معاوضه) */
export const orderShippingVideoMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      ensureDir(ORDER_VIDEO_UPLOAD_DIR);
      cb(null, ORDER_VIDEO_UPLOAD_DIR);
    },
    filename: (_req, file, cb) => {
      cb(null, `video-${randomUUID()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!VIDEO_MIME.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          `فقط فایل‌های ویدیویی مجازند؛ حداکثر حجم ${ORDER_SHIPPING_VIDEO_MAX_LABEL}.`,
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: ORDER_SHIPPING_VIDEO_MAX_BYTES },
};
