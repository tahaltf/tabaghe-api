import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const UPLOAD_PATH = './uploads/deposit-receipts';
const ALLOWED_MIME_REGEX = /\/(jpg|jpeg|png|webp)$/;

/**
 * Multer options for bank-transfer / manual deposit receipt images.
 * Files are stored under `/uploads/deposit-receipts/` and served
 * as static assets so the admin can review them.
 */
export const depositReceiptMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOAD_PATH)) mkdirSync(UPLOAD_PATH, { recursive: true });
      cb(null, UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `receipt-${uuidv4()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException('فقط فایل‌های تصویری (jpg, png, webp) مجاز هستند'),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 },
};
