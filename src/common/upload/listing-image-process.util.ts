import { rename, unlink } from 'fs/promises';
import { join, parse, resolve } from 'path';
import sharp = require('sharp');

export const LISTING_UPLOAD_DIR = './uploads/listings';

/** Max width for each responsive variant (WebP). */
export const LISTING_IMAGE_VARIANTS = {
  thumb: 320,
  card: 640,
  full: 1280,
} as const;

export type ListingImageVariant = keyof typeof LISTING_IMAGE_VARIANTS;

/**
 * Process an on-disk image into WebP variants (full / card / thumb).
 * Returns the canonical gallery filename (`{id}.webp`).
 * Deletes the source file when it is not already the canonical name.
 */
export async function processListingImageAtPath(
  srcPath: string,
  originalFilename: string,
  uploadDir = LISTING_UPLOAD_DIR,
): Promise<string> {
  const { name } = parse(originalFilename);
  const canonical = `${name}.webp`;
  const fullPath = join(uploadDir, canonical);
  // Sharp cannot read+write the same path; use a temp file when overwriting.
  const samePath = resolve(srcPath) === resolve(fullPath);
  const fullOutPath = samePath ? join(uploadDir, `${name}.full.tmp.webp`) : fullPath;

  const base = sharp(srcPath, { animated: false, failOn: 'none' }).rotate();

  await Promise.all([
    base
      .clone()
      .resize({
        width: LISTING_IMAGE_VARIANTS.full,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .webp({ quality: 82 })
      .toFile(fullOutPath),
    base
      .clone()
      .resize({
        width: LISTING_IMAGE_VARIANTS.card,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .webp({ quality: 78 })
      .toFile(join(uploadDir, `${name}-card.webp`)),
    base
      .clone()
      .resize({
        width: LISTING_IMAGE_VARIANTS.thumb,
        withoutEnlargement: true,
        fit: 'inside',
      })
      .webp({ quality: 72 })
      .toFile(join(uploadDir, `${name}-thumb.webp`)),
  ]);

  if (samePath) {
    await rename(fullOutPath, fullPath);
  } else {
    try {
      await unlink(srcPath);
    } catch {
      // original may already be gone
    }
  }

  return canonical;
}

/**
 * Process a Multer disk file into WebP variants.
 * Returns the canonical gallery filename (`{id}.webp`).
 */
export async function processListingImageUpload(
  file: Express.Multer.File,
  uploadDir = LISTING_UPLOAD_DIR,
): Promise<string> {
  const srcPath = file.path || join(uploadDir, file.filename);
  return processListingImageAtPath(srcPath, file.filename, uploadDir);
}

export async function processListingImageUploads(
  files: Array<Express.Multer.File> | undefined,
): Promise<string[]> {
  if (!files?.length) return [];
  const names: string[] = [];
  for (const file of files) {
    names.push(await processListingImageUpload(file));
  }
  return names;
}

/** Derive variant filename from a stored gallery/thumbnail name. */
export function listingImageVariantName(
  filename: string,
  variant: ListingImageVariant,
): string {
  if (!filename || filename.startsWith('http')) return filename;
  const cleaned = filename.replace(/^\/+/, '');
  if (/-(?:thumb|card|full)(?:\.[^.]+)?$/i.test(cleaned)) {
    return cleaned;
  }
  const { name, ext } = parse(cleaned);
  if (variant === 'full') {
    return ext.toLowerCase() === '.webp' ? cleaned : `${name}.webp`;
  }
  return `${name}-${variant}.webp`;
}
