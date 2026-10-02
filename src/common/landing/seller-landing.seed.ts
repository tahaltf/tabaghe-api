import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerceLandingSections } from './landing-sections.util';

export const SELLER_LANDING_SLUG = 'seller';
export const SELLER_LANDING_SECTION_COUNT = 17;

const SELLER_LANDING_META = {
  seoTitle: 'طبقه | فروش بدون بیعانهٔ مبهم',
  seoDescription:
    'برای فروشنده: پول خریدار تا تأیید پیش طبقه می‌ماند، مسیر کالا ثبت می‌شود، و از حجره تا وردپرس می‌توانی بفروشی.',
  showHeader: true,
  showFooter: true,
} as const;

function seedDataPath(): string {
  return join(process.cwd(), 'prisma', 'seed-data', 'seller-landing-sections.json');
}

/** Sections mirrored from tabaghe-frontend landing.defaults.ts SELLER_LANDING_SEED_SECTIONS */
export function loadSellerLandingSeedSections(): unknown[] {
  const raw = readFileSync(seedDataPath(), 'utf8');
  return coerceLandingSections(JSON.parse(raw));
}

export function sellerLandingSeedMeta(): Record<string, unknown> {
  return { ...SELLER_LANDING_META };
}

export function sellerLandingSeedTitle(): string {
  return 'راهنمای فروشنده';
}

export function sellerLandingSeedDescription(): string {
  return 'صفحهٔ کامل فروش در طبقه';
}
