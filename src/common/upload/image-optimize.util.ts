import { rename, unlink, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { join, parse, resolve, extname } from 'path';
import sharp = require('sharp');
import {
  LISTING_IMAGE_VARIANTS,
  LISTING_UPLOAD_DIR,
  processListingImageAtPath,
} from './listing-image-process.util';

export type ImageOptimizeProfile = 'listing' | 'banner' | 'content' | 'brand';

/** Max edge / quality for single-file WebP profiles (visually near-lossless). */
export const IMAGE_OPTIMIZE_PROFILES = {
  banner: { maxWidth: 1920, quality: 82 },
  content: { maxWidth: 1600, quality: 80 },
  brand: { maxWidth: 1024, quality: 85 },
} as const;

export type SingleImageProfile = keyof typeof IMAGE_OPTIMIZE_PROFILES;

const RASTER_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.tif', '.tiff']);
const SKIP_EXT = new Set(['.svg', '.ico', '.bmp']);

export function isOptimizableImageFilename(filename: string): boolean {
  const ext = extname(filename).toLowerCase();
  if (SKIP_EXT.has(ext)) return false;
  return RASTER_EXT.has(ext);
}

export function isListingVariantFilename(filename: string): boolean {
  return /-(?:thumb|card|full)\./i.test(filename);
}

export interface OptimizeImageResult {
  filename: string;
  profile: ImageOptimizeProfile;
  bytesBefore: number;
  bytesAfter: number;
  skipped: boolean;
  reason?: string;
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export interface OptimizeSingleOptions {
  /** When true (default for uploads), remove the source file if it differs from the WebP output. */
  deleteSource?: boolean;
}

/**
 * Compress a single raster image to WebP (banner / content / brand).
 * Returns the canonical `{name}.webp` filename.
 */
export async function optimizeSingleImageAtPath(
  srcPath: string,
  originalFilename: string,
  uploadDir: string,
  profile: SingleImageProfile,
  options: OptimizeSingleOptions = {},
): Promise<OptimizeImageResult> {
  const deleteSource = options.deleteSource !== false;
  const cfg = IMAGE_OPTIMIZE_PROFILES[profile];
  const { name } = parse(originalFilename);
  const canonical = `${name}.webp`;
  const outPath = join(uploadDir, canonical);
  const bytesBefore = await fileSize(srcPath);

  if (!isOptimizableImageFilename(originalFilename)) {
    return {
      filename: originalFilename,
      profile,
      bytesBefore,
      bytesAfter: bytesBefore,
      skipped: true,
      reason: 'unsupported-type',
    };
  }

  const samePath = resolve(srcPath) === resolve(outPath);
  const tmpOut = samePath ? join(uploadDir, `${name}.opt.tmp.webp`) : outPath;

  await sharp(srcPath, { animated: false, failOn: 'none' })
    .rotate()
    .resize({
      width: cfg.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    })
    .webp({ quality: cfg.quality, effort: 4 })
    .toFile(tmpOut);

  if (samePath) {
    await rename(tmpOut, outPath);
  } else if (deleteSource) {
    try {
      await unlink(srcPath);
    } catch {
      // source may already be gone
    }
  }

  const bytesAfter = await fileSize(outPath);
  return {
    filename: canonical,
    profile,
    bytesBefore,
    bytesAfter,
    skipped: false,
  };
}

export async function optimizeSingleImageUpload(
  file: Express.Multer.File,
  uploadDir: string,
  profile: SingleImageProfile,
): Promise<OptimizeImageResult> {
  const srcPath = file.path || join(uploadDir, file.filename);
  return optimizeSingleImageAtPath(srcPath, file.filename, uploadDir, profile);
}

/**
 * Listing gallery pipeline (thumb / card / full WebP).
 */
export async function optimizeListingImageAtPath(
  srcPath: string,
  originalFilename: string,
  uploadDir = LISTING_UPLOAD_DIR,
): Promise<OptimizeImageResult> {
  const bytesBefore = await fileSize(srcPath);
  if (!isOptimizableImageFilename(originalFilename)) {
    return {
      filename: originalFilename,
      profile: 'listing',
      bytesBefore,
      bytesAfter: bytesBefore,
      skipped: true,
      reason: 'unsupported-type',
    };
  }
  if (isListingVariantFilename(originalFilename)) {
    return {
      filename: originalFilename,
      profile: 'listing',
      bytesBefore,
      bytesAfter: bytesBefore,
      skipped: true,
      reason: 'variant-file',
    };
  }

  const { name } = parse(originalFilename);
  const canonical = `${name}.webp`;
  const thumbPath = join(uploadDir, `${name}-thumb.webp`);
  const cardPath = join(uploadDir, `${name}-card.webp`);
  const fullPath = join(uploadDir, canonical);

  if (
    existsSync(thumbPath) &&
    existsSync(cardPath) &&
    existsSync(fullPath) &&
    resolve(srcPath) === resolve(fullPath)
  ) {
    // Already fully optimized; optionally re-encode if caller force-runs via processListing.
    const bytesAfter =
      (await fileSize(fullPath)) +
      (await fileSize(cardPath)) +
      (await fileSize(thumbPath));
    return {
      filename: canonical,
      profile: 'listing',
      bytesBefore,
      bytesAfter,
      skipped: true,
      reason: 'already-optimized',
    };
  }

  const filename = await processListingImageAtPath(
    srcPath,
    originalFilename,
    uploadDir,
  );
  const bytesAfter =
    (await fileSize(join(uploadDir, filename))) +
    (await fileSize(join(uploadDir, `${name}-card.webp`))) +
    (await fileSize(join(uploadDir, `${name}-thumb.webp`)));

  return {
    filename,
    profile: 'listing',
    bytesBefore,
    bytesAfter,
    skipped: false,
  };
}

export { LISTING_IMAGE_VARIANTS, LISTING_UPLOAD_DIR };
