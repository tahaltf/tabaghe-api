import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const IMAGE_PATH = './uploads/repairs/images';
const VIDEO_PATH = './uploads/repairs/videos';
const IMAGE_MIME = /\/(jpg|jpeg|png|webp|gif)$/;
const VIDEO_MIME = /\/(mp4|mov|quicktime|x-msvideo|mpeg|webm)$/;

const ensure = (path: string) => {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
};

/**
 * Multer options for the repair-request initial submission form.
 * Accepts **up to 6 images** (field `images`) and **up to 2 videos** (field `videos`).
 * Files are stored under `/uploads/repairs/images` or `/uploads/repairs/videos`.
 */
export const repairMediaMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, file, cb) => {
      const dir = file.fieldname === 'videos' ? VIDEO_PATH : IMAGE_PATH;
      ensure(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const prefix = file.fieldname === 'videos' ? 'repair-vid' : 'repair-img';
      cb(null, `${prefix}-${uuidv4()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const isVideo = file.fieldname === 'videos';
    const regex = isVideo ? VIDEO_MIME : IMAGE_MIME;
    if (!regex.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          isVideo
            ? 'فقط فایل‌های ویدیویی مجاز هستند'
            : 'فقط فایل‌های تصویری (jpg, png, webp, gif) مجاز هستند',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: 50 * 1024 * 1024 },
};

/**
 * Multer options for single-field "shipping video" uploads used when the user sends
 * the device TO the hub, or when the hub ships back to the user.
 */
export const repairShipVideoMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      ensure(VIDEO_PATH);
      cb(null, VIDEO_PATH);
    },
    filename: (_req, file, cb) => {
      cb(null, `repair-ship-${uuidv4()}${extname(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!VIDEO_MIME.test(file.mimetype)) {
      return cb(new BadRequestException('فقط فایل‌های ویدیویی مجاز هستند'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 80 * 1024 * 1024 },
};

export const REPAIR_IMAGE_SUBDIR = 'repairs/images';
export const REPAIR_VIDEO_SUBDIR = 'repairs/videos';
