import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ABOUT_US_FA,
  DEFAULT_FAQ_ITEMS,
  DEFAULT_FOOTER_TAGLINE_FA,
  DEFAULT_SYSTEM_INTRO_FA,
  DEFAULT_TERMS_CONDITIONS_FA,
} from './index';

const CONTENT_SETTINGS: Array<{
  key: string;
  value: string;
  description: string;
}> = [
  {
    key: 'TERMS_CONDITIONS',
    value: DEFAULT_TERMS_CONDITIONS_FA,
    description: 'متن قوانین و مقررات (نمایش به کاربران)',
  },
  {
    key: 'ABOUT_US',
    value: DEFAULT_ABOUT_US_FA,
    description: 'متن صفحه درباره ما',
  },
  {
    key: 'FOOTER_TAGLINE',
    value: DEFAULT_FOOTER_TAGLINE_FA,
    description: 'معرفی کوتاه فوتر سایت',
  },
  {
    key: 'SYSTEM_INTRO_CONTENT',
    value: DEFAULT_SYSTEM_INTRO_FA,
    description: 'محتوای صفحه معرفی سامانه',
  },
];

export interface PlatformContentSeedOptions {
  /** بازنویسی تنظیمات حتی اگر مقدار داشته باشند */
  forceSettings?: boolean;
  /** حذف FAQهای موجود و جایگزینی با پیش‌فرض */
  forceFaqs?: boolean;
}

export interface PlatformContentSettingResult {
  key: string;
  action: 'created' | 'updated' | 'skipped';
}

export interface PlatformContentSeedResult {
  settings: PlatformContentSettingResult[];
  faqs: { action: 'created' | 'replaced' | 'skipped'; count: number };
}

/** تنظیمات متنی — پیش‌فرض فقط جاهای خالی */
export async function seedContentSettings(
  prisma: PrismaClient,
  options: PlatformContentSeedOptions = {},
): Promise<PlatformContentSettingResult[]> {
  const results: PlatformContentSettingResult[] = [];
  const force = options.forceSettings === true;

  for (const item of CONTENT_SETTINGS) {
    const existing = await prisma.systemSetting.findUnique({
      where: { key: item.key },
      select: { value: true },
    });

    if (existing?.value?.trim() && !force) {
      results.push({ key: item.key, action: 'skipped' });
      continue;
    }

    const hadValue = Boolean(existing?.value?.trim());
    await prisma.systemSetting.upsert({
      where: { key: item.key },
      create: {
        key: item.key,
        value: item.value,
        description: item.description,
      },
      update: { value: item.value, description: item.description },
    });
    results.push({
      key: item.key,
      action: hadValue ? 'updated' : 'created',
    });
  }

  return results;
}

/** FAQ — پیش‌فرض فقط وقتی جدول خالی است */
export async function seedFaqs(
  prisma: PrismaClient,
  options: PlatformContentSeedOptions = {},
): Promise<{ action: 'created' | 'replaced' | 'skipped'; count: number }> {
  const count = await prisma.faq.count();
  const force = options.forceFaqs === true;

  if (count > 0 && !force) {
    return { action: 'skipped', count };
  }

  if (count > 0 && force) {
    await prisma.faq.deleteMany({});
  }

  for (const item of DEFAULT_FAQ_ITEMS) {
    await prisma.faq.create({
      data: {
        question: item.question,
        answer: item.answer,
        category: item.category,
        order: item.order,
        isActive: true,
      },
    });
  }

  return {
    action: count > 0 && force ? 'replaced' : 'created',
    count: DEFAULT_FAQ_ITEMS.length,
  };
}

/** Seed یکپارچه محتوای عمومی — CLI، prisma seed و API ادمین */
export async function seedPlatformContent(
  prisma: PrismaClient,
  options: PlatformContentSeedOptions = {},
): Promise<PlatformContentSeedResult> {
  const settings = await seedContentSettings(prisma, options);
  const faqs = await seedFaqs(prisma, options);
  return { settings, faqs };
}
