import { BadRequestException } from '@nestjs/common';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname } from 'path';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';

const MAX_BACKUP_BYTES = 1024 * 1024 * 1024; // 1 GB

function backupDir(): string {
  return (
    process.env.BACKUP_DIR?.trim() || '/var/backups/tabagheh/postgres'
  ).replace(/\\/g, '/');
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function safeBackupFileName(original: string): string {
  const base = original.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (/^tabagheh_db_[\d]{4}-[\d]{2}-[\d]{2}_[\d]{4}\.dump$/.test(base)) {
    return base;
  }
  if (/^tabagheh_db_.+\.dump$/.test(base)) {
    return base;
  }
  const ext = extname(base) || '.dump';
  return `tabagheh_db_upload_${timestamp()}${ext}`;
}

export const backupDumpMulterOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      const dir = backupDir();
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      cb(null, safeBackupFileName(file.originalname || 'backup.dump'));
    },
  }),
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    if (!name.endsWith('.dump')) {
      return cb(
        new BadRequestException(
          'فقط فایل PostgreSQL custom dump با پسوند .dump مجاز است',
        ),
        false,
      );
    }
    cb(null, true);
  },
  limits: { fileSize: MAX_BACKUP_BYTES },
};

export { MAX_BACKUP_BYTES, backupDir as resolveBackupUploadDir };
