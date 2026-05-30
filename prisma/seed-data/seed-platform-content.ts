import type { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ABOUT_US_FA,
  DEFAULT_FAQ_ITEMS,
  DEFAULT_FOOTER_TAGLINE_FA,
  DEFAULT_SYSTEM_INTRO_FA,
  DEFAULT_TERMS_CONDITIONS_FA,
} from '../../src/common/content';

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

/** تنظیمات متنی را فقط وقتی مقدار خالی است seed می‌کند */
export async function seedContentSettings(prisma: PrismaClient): Promise<void> {
  for (const item of CONTENT_SETTINGS) {
    const existing = await prisma.systemSetting.findUnique({
      where: { key: item.key },
      select: { value: true },
    });
    if (existing?.value?.trim()) continue;

    await prisma.systemSetting.upsert({
      where: { key: item.key },
      create: {
        key: item.key,
        value: item.value,
        description: item.description,
      },
      update: { value: item.value, description: item.description },
    });
    console.log(`  ✓ ${item.key}`);
  }
}

/** FAQ را فقط وقتی جدول خالی است seed می‌کند */
export async function seedFaqs(prisma: PrismaClient): Promise<void> {
  const count = await prisma.faq.count();
  if (count > 0) {
    console.log(`  ↷ FAQ (${count} رکورد موجود — رد شد)`);
    return;
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
  console.log(`  ✓ ${DEFAULT_FAQ_ITEMS.length} سوال متداول`);
}

export async function seedPlatformContent(prisma: PrismaClient): Promise<void> {
  console.log('📄 Seed محتوای عمومی (قوانین، درباره ما، معرفی، FAQ)...');
  await seedContentSettings(prisma);
  await seedFaqs(prisma);
}
