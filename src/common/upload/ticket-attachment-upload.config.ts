import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { DEFAULT_TICKET_ATTACHMENT_MAX_SIZE_MB } from './ticket-attachment-settings.util';

export const TICKET_UPLOAD_PATH = './uploads/tickets';

const BROAD_ALLOWED_MIME_REGEX =
  /^(image\/(jpeg|png|webp|gif)|application\/pdf)$/i;

/**
 * Multer options for ticket message attachments.
 * Exact allowed types and size are enforced again in the service using admin settings.
 */
export const ticketAttachmentMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(TICKET_UPLOAD_PATH)) {
        mkdirSync(TICKET_UPLOAD_PATH, { recursive: true });
      }
      cb(null, TICKET_UPLOAD_PATH);
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase() || '';
      cb(null, `ticket-${randomUUID()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!BROAD_ALLOWED_MIME_REGEX.test(file.mimetype)) {
      return cb(
        new BadRequestException(
          'فقط فایل تصویری یا PDF مجاز است.',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: {
    fileSize: 20 * 1024 * 1024,
  },
};

export const ticketAttachmentMulterHardLimitBytes =
  DEFAULT_TICKET_ATTACHMENT_MAX_SIZE_MB * 1024 * 1024;
