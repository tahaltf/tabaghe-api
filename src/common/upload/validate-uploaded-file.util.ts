import { readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import {
  assertFileSignature,
  type DetectedKind,
} from './file-signature.validator';

export function validateUploadedFileSignature(
  file: Express.Multer.File | undefined,
  allowed: readonly DetectedKind[],
  label = 'فایل',
): void {
  if (!file?.filename) return;

  const filePath =
    file.path ??
    join(process.cwd(), file.destination ?? 'uploads/national-cards', file.filename);

  let buffer: Buffer;
  try {
    buffer = readFileSync(filePath);
  } catch {
    throw new BadRequestException(`${label} قابل خواندن نیست.`);
  }

  try {
    assertFileSignature(buffer, allowed, label);
  } catch (err) {
    try {
      unlinkSync(filePath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}
