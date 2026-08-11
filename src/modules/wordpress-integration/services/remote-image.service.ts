import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { extname } from 'path';
import { randomUUID } from 'crypto';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import {
  LISTING_UPLOAD_DIR,
  processListingImageAtPath,
} from '../../../common/upload/listing-image-process.util';

const UPLOAD_PATH = LISTING_UPLOAD_DIR;
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);
const MAX_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

@Injectable()
export class RemoteImageService {
  private readonly logger = new Logger(RemoteImageService.name);

  async downloadMany(urls: string[]): Promise<string[]> {
    const unique = [...new Set(urls.filter(Boolean))];
    const filenames: string[] = [];

    for (const url of unique) {
      try {
        const filename = await this.downloadOne(url);
        if (filename) filenames.push(filename);
      } catch (err) {
        this.logger.warn(
          `Failed to download image ${url}: ${String((err as Error)?.message ?? err)}`,
        );
      }
    }

    return filenames;
  }

  private async downloadOne(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'Tabaghe-WordPress-Sync/1.0' },
      });

      if (!response.ok) {
        throw new BadRequestException(`HTTP ${response.status}`);
      }

      const contentType = response.headers.get('content-type') ?? '';
      const ext = this.resolveExtension(url, contentType);
      if (!ALLOWED_EXT.has(ext)) {
        throw new BadRequestException(`Unsupported image type: ${contentType || ext}`);
      }

      const contentLength = Number(response.headers.get('content-length') ?? 0);
      if (contentLength > MAX_BYTES) {
        throw new BadRequestException('Image too large');
      }

      if (!existsSync(UPLOAD_PATH)) {
        mkdirSync(UPLOAD_PATH, { recursive: true });
      }

      const filename = `${randomUUID()}${ext}`;
      const dest = `${UPLOAD_PATH}/${filename}`;
      const body = response.body;
      if (!body) {
        throw new BadRequestException('Empty response body');
      }

      let downloaded = 0;
      const nodeStream = Readable.fromWeb(body as import('stream/web').ReadableStream);
      nodeStream.on('data', (chunk: Buffer) => {
        downloaded += chunk.length;
        if (downloaded > MAX_BYTES) {
          nodeStream.destroy();
          throw new BadRequestException('Image too large');
        }
      });

      await pipeline(nodeStream, createWriteStream(dest));

      // Same Sharp pipeline as manual uploads so public pages get -thumb/-card variants.
      try {
        return await processListingImageAtPath(dest, filename, UPLOAD_PATH);
      } catch (err) {
        this.logger.warn(
          `Failed to process listing image ${filename}, keeping original: ${String((err as Error)?.message ?? err)}`,
        );
        // Keep the raw download so admin/public can still show a plain `src`.
        return filename;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private resolveExtension(url: string, contentType: string): string {
    const fromMime: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    const mime = contentType.split(';')[0]?.trim().toLowerCase();
    if (mime && fromMime[mime]) return fromMime[mime];

    const fromUrl = extname(new URL(url).pathname).toLowerCase();
    if (ALLOWED_EXT.has(fromUrl)) return fromUrl;

    return '.jpg';
  }
}
