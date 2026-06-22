import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coerceLandingSections } from './landing-sections.util';

export const INVITE_LANDING_SLUG = 'invite';
export const INVITE_LANDING_SECTION_COUNT = 10;

const INVITE_LANDING_META = {
  seoTitle: 'طبقه | پنت‌هاوس رایگان',
  seoDescription: 'پنت‌هاوس ۷۹۹ هزار تومانی را رایگان بگیر و فروش حرفه‌ای را در طبقه شروع کن.',
  showHeader: false,
  showFooter: false,
  campaignHeaderCta: 'دریافت پنت‌هاوس رایگان',
} as const;

function seedDataPath(): string {
  return join(process.cwd(), 'prisma', 'seed-data', 'invite-landing-sections.json');
}

/** Sections mirrored from tabaghe-frontend landing.defaults.ts SELLER_PROMO_LANDING_SEED_SECTIONS */
export function loadInviteLandingSeedSections(): unknown[] {
  const raw = readFileSync(seedDataPath(), 'utf8');
  return coerceLandingSections(JSON.parse(raw));
}

export function inviteLandingSeedMeta(): Record<string, unknown> {
  return { ...INVITE_LANDING_META };
}

export function inviteLandingSeedTitle(): string {
  return 'دعوت فروشندگان — پنت‌هاوس رایگان';
}

export function inviteLandingSeedDescription(): string {
  return 'لندینگ دعوت فروشندگان با پنت‌هاوس رایگان';
}
