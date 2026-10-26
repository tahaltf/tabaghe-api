import { Injectable, Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, parse } from 'path';
import { BANNER_UPLOAD_PATH } from './banner-upload.config';
import { BRAND_LOGO_UPLOAD_PATH } from './brand-logo-upload.config';
import {
  IMAGE_OPTIMIZE_PROFILES,
  isListingVariantFilename,
  isOptimizableImageFilename,
  optimizeListingImageAtPath,
  optimizeSingleImageAtPath,
  optimizeSingleImageUpload,
  type ImageOptimizeProfile,
  type OptimizeImageResult,
  type SingleImageProfile,
  LISTING_UPLOAD_DIR,
} from './image-optimize.util';

export type OptimizeTarget = 'listings' | 'banners' | 'brand';

export interface OptimizeDirectorySummary {
  target: OptimizeTarget;
  dir: string;
  processed: number;
  skipped: number;
  failed: number;
  bytesSaved: number;
  results: Array<OptimizeImageResult & { source: string; error?: string }>;
}

@Injectable()
export class ImageOptimizeService {
  private readonly logger = new Logger(ImageOptimizeService.name);

  /** Optimize a Multer disk upload in-place for the given profile. */
  async optimizeUpload(
    file: Express.Multer.File,
    uploadDir: string,
    profile: SingleImageProfile,
  ): Promise<OptimizeImageResult> {
    const result = await optimizeSingleImageUpload(file, uploadDir, profile);
    if (!result.skipped) {
      this.logger.log(
        `Optimized ${file.filename} → ${result.filename} (${result.bytesBefore}→${result.bytesAfter} B, ${profile})`,
      );
    }
    return result;
  }

  async optimizeBannerUpload(file: Express.Multer.File): Promise<OptimizeImageResult> {
    return this.optimizeUpload(file, BANNER_UPLOAD_PATH, 'banner');
  }

  async optimizeContentUpload(file: Express.Multer.File): Promise<OptimizeImageResult> {
    return this.optimizeUpload(file, BANNER_UPLOAD_PATH, 'content');
  }

  async optimizeBrandUpload(file: Express.Multer.File): Promise<OptimizeImageResult> {
    const ext = parse(file.filename).ext.toLowerCase();
    if (ext === '.svg') {
      const size = file.size ?? 0;
      return {
        filename: file.filename,
        profile: 'brand',
        bytesBefore: size,
        bytesAfter: size,
        skipped: true,
        reason: 'svg',
      };
    }
    return this.optimizeUpload(file, BRAND_LOGO_UPLOAD_PATH, 'brand');
  }

  /** Batch-optimize files already on disk. */
  async optimizeDirectory(
    target: OptimizeTarget,
    options: { limit?: number; force?: boolean } = {},
  ): Promise<OptimizeDirectorySummary> {
    const dir = this.resolveDir(target);
    const summary: OptimizeDirectorySummary = {
      target,
      dir,
      processed: 0,
      skipped: 0,
      failed: 0,
      bytesSaved: 0,
      results: [],
    };

    if (!existsSync(dir)) {
      this.logger.warn(`Upload dir missing: ${dir}`);
      return summary;
    }

    const files = await readdir(dir);
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;

    for (const file of files) {
      if (remaining <= 0) break;
      if (!isOptimizableImageFilename(file)) {
        summary.skipped += 1;
        continue;
      }
      if (target === 'listings' && isListingVariantFilename(file)) {
        summary.skipped += 1;
        continue;
      }

      const srcPath = join(dir, file);
      try {
        const result = await this.optimizeFile(target, srcPath, file, options.force);
        summary.results.push({ ...result, source: file });
        if (result.skipped) {
          summary.skipped += 1;
        } else {
          summary.processed += 1;
          summary.bytesSaved += Math.max(0, result.bytesBefore - result.bytesAfter);
          remaining -= 1;
        }
      } catch (err) {
        summary.failed += 1;
        summary.results.push({
          filename: file,
          profile: this.profileForTarget(target),
          bytesBefore: 0,
          bytesAfter: 0,
          skipped: true,
          reason: 'error',
          source: file,
          error: err instanceof Error ? err.message : String(err),
        });
        this.logger.error(`Failed optimizing ${file}`, err instanceof Error ? err.stack : err);
      }
    }

    this.logger.log(
      `Optimize ${target}: processed=${summary.processed} skipped=${summary.skipped} failed=${summary.failed} saved≈${Math.round(summary.bytesSaved / 1024)}KB`,
    );
    return summary;
  }

  async optimizeTargets(
    targets: OptimizeTarget[],
    options: { limit?: number; force?: boolean } = {},
  ): Promise<OptimizeDirectorySummary[]> {
    const out: OptimizeDirectorySummary[] = [];
    for (const target of targets) {
      out.push(await this.optimizeDirectory(target, options));
    }
    return out;
  }

  getProfiles() {
    return {
      listing: { variants: { thumb: 320, card: 640, full: 1280 } },
      ...IMAGE_OPTIMIZE_PROFILES,
    };
  }

  private async optimizeFile(
    target: OptimizeTarget,
    srcPath: string,
    filename: string,
    force?: boolean,
  ): Promise<OptimizeImageResult> {
    if (target === 'listings') {
      const { name } = parse(filename);
      const fullPath = join(LISTING_UPLOAD_DIR, `${name}.webp`);
      const thumbPath = join(LISTING_UPLOAD_DIR, `${name}-thumb.webp`);
      const cardPath = join(LISTING_UPLOAD_DIR, `${name}-card.webp`);
      if (
        !force &&
        existsSync(fullPath) &&
        existsSync(thumbPath) &&
        existsSync(cardPath)
      ) {
        return {
          filename: `${name}.webp`,
          profile: 'listing',
          bytesBefore: 0,
          bytesAfter: 0,
          skipped: true,
          reason: 'already-optimized',
        };
      }
      return optimizeListingImageAtPath(srcPath, filename, LISTING_UPLOAD_DIR);
    }

    const profile = this.profileForTarget(target) as SingleImageProfile;
    const { name } = parse(filename);
    const canonical = `${name}.webp`;
    const outPath = join(this.resolveDir(target), canonical);
    if (!force && filename === canonical && existsSync(outPath)) {
      // Re-encode existing webp only when force=true; otherwise skip.
      return {
        filename: canonical,
        profile,
        bytesBefore: 0,
        bytesAfter: 0,
        skipped: true,
        reason: 'already-webp',
      };
    }
    // Batch keeps the original as DB fallback; uploads delete via optimizeUpload().
    return optimizeSingleImageAtPath(srcPath, filename, this.resolveDir(target), profile, {
      deleteSource: false,
    });
  }

  private resolveDir(target: OptimizeTarget): string {
    if (target === 'listings') return LISTING_UPLOAD_DIR;
    if (target === 'brand') return BRAND_LOGO_UPLOAD_PATH;
    return BANNER_UPLOAD_PATH;
  }

  private profileForTarget(target: OptimizeTarget): ImageOptimizeProfile {
    if (target === 'listings') return 'listing';
    if (target === 'brand') return 'brand';
    return 'banner';
  }
}
