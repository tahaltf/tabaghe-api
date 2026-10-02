import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerceLandingSections } from './landing-sections.util';

export const BUYER_LANDING_SLUG = 'buyer';
export const BUYER_LANDING_SECTION_COUNT = 18;

const BUYER_LANDING_META = {
  seoTitle: 'طبقه | خرید بدون بیعانه به کارت شخصی',
  seoDescription:
    'برای خریدار: پول تا تأیید خودت پیش طبقه می‌ماند، کارشناسی هاب اختیاری است، و پرداخت فقط داخل سفارش انجام می‌شود.',
  showHeader: true,
  showFooter: true,
} as const;

function seedDataPath(): string {
  return join(process.cwd(), 'prisma', 'seed-data', 'buyer-landing-sections.json');
}

/** Sections mirrored from tabaghe-frontend landing content JSON */
export function loadBuyerLandingSeedSections(): unknown[] {
  const raw = readFileSync(seedDataPath(), 'utf8');
  return coerceLandingSections(JSON.parse(raw));
}

export function buyerLandingSeedMeta(): Record<string, unknown> {
  return { ...BUYER_LANDING_META };
}

export function buyerLandingSeedTitle(): string {
  return 'راهنمای خریدار';
}

export function buyerLandingSeedDescription(): string {
  return 'صفحهٔ کامل خرید در طبقه';
}
