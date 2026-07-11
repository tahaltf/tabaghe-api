/**
 * One-shot migration: generate -thumb / -card / .webp variants for existing listing uploads.
 *
 * Usage (from tabaghe-api):
 *   npx ts-node -r tsconfig-paths/register scripts/migrate-listing-image-variants.ts
 */
import { existsSync } from 'fs';
import { readdir, unlink } from 'fs/promises';
import { join, parse } from 'path';
import sharp = require('sharp');

const UPLOAD_DIR = process.env.LISTING_UPLOAD_DIR || './uploads/listings';
const WIDTHS = { thumb: 320, card: 640, full: 1280 } as const;

async function processFile(filename: string): Promise<boolean> {
  if (/-(?:thumb|card|full)\./i.test(filename)) return false;
  if (!/\.(jpe?g|png|gif|webp)$/i.test(filename)) return false;

  const srcPath = join(UPLOAD_DIR, filename);
  const { name } = parse(filename);
  const canonical = `${name}.webp`;
  const thumbPath = join(UPLOAD_DIR, `${name}-thumb.webp`);
  const cardPath = join(UPLOAD_DIR, `${name}-card.webp`);
  const fullPath = join(UPLOAD_DIR, canonical);

  if (existsSync(thumbPath) && existsSync(cardPath) && existsSync(fullPath)) {
    return false;
  }

  const base = sharp(srcPath, { animated: false, failOn: 'none' }).rotate();
  await Promise.all([
    base
      .clone()
      .resize({ width: WIDTHS.full, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 82 })
      .toFile(fullPath),
    base
      .clone()
      .resize({ width: WIDTHS.card, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 78 })
      .toFile(cardPath),
    base
      .clone()
      .resize({ width: WIDTHS.thumb, withoutEnlargement: true, fit: 'inside' })
      .webp({ quality: 72 })
      .toFile(thumbPath),
  ]);

  if (filename !== canonical && existsSync(fullPath)) {
    // Keep original as fallback for DB rows that still point to it.
  }

  return true;
}

async function main() {
  if (!existsSync(UPLOAD_DIR)) {
    console.error(`Upload dir not found: ${UPLOAD_DIR}`);
    process.exit(1);
  }
  const files = await readdir(UPLOAD_DIR);
  let done = 0;
  for (const file of files) {
    try {
      if (await processFile(file)) {
        done += 1;
        console.log('ok', file);
      }
    } catch (err) {
      console.error('fail', file, err);
    }
  }
  console.log(`Migrated ${done} listing image(s).`);
}

void main();
