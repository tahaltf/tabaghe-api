/**
 * Seed محتوای عمومی — بدون ts-node (برای Docker production).
 * پیش‌نیاز: npm run build (خروجی در dist/src/common/content)
 */
const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

function loadDefaultContent() {
  const contentDir = path.join(__dirname, '../dist/src/common/content');
  const indexJs = path.join(contentDir, 'index.js');
  if (!fs.existsSync(indexJs)) {
    throw new Error(
      'dist/src/common/content یافت نشد. ابتدا npm run build را اجرا کنید یا از seed:content:dev استفاده کنید.',
    );
  }
  return require(contentDir);
}

async function seedContentSettings(prisma, content) {
  const items = [
    {
      key: 'TERMS_CONDITIONS',
      value: content.DEFAULT_TERMS_CONDITIONS_FA,
      description: 'متن قوانین و مقررات (نمایش به کاربران)',
    },
    {
      key: 'ABOUT_US',
      value: content.DEFAULT_ABOUT_US_FA,
      description: 'متن صفحه درباره ما',
    },
    {
      key: 'SYSTEM_INTRO_CONTENT',
      value: content.DEFAULT_SYSTEM_INTRO_FA,
      description: 'محتوای صفحه معرفی سامانه',
    },
  ];

  for (const item of items) {
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

async function seedFaqs(prisma, faqItems) {
  const count = await prisma.faq.count();
  if (count > 0) {
    console.log(`  ↷ FAQ (${count} رکورد موجود — رد شد)`);
    return;
  }

  for (const item of faqItems) {
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
  console.log(`  ✓ ${faqItems.length} سوال متداول`);
}

async function main() {
  const content = loadDefaultContent();
  const prisma = new PrismaClient();

  console.log('📄 Seed محتوای عمومی (قوانین، درباره ما، معرفی، FAQ)...');
  await seedContentSettings(prisma, content);
  await seedFaqs(prisma, content.DEFAULT_FAQ_ITEMS);
  console.log('✅ محتوای عمومی seed شد.');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
