/**
 * Seed محتوای عمومی — entry واحد برای Docker/production (بدون ts-node).
 * پیش‌نیاز: npm run build
 */
const { PrismaClient } = require('@prisma/client');
const {
  seedPlatformContent,
} = require('../dist/src/common/content/platform-content.seed');

async function main() {
  const prisma = new PrismaClient();
  console.log('📄 Seed محتوای عمومی (قوانین، درباره ما، معرفی، FAQ)...');
  const result = await seedPlatformContent(prisma);
  for (const s of result.settings) {
    if (s.action !== 'skipped') console.log(`  ✓ ${s.key} (${s.action})`);
  }
  if (result.faqs.action !== 'skipped') {
    console.log(`  ✓ FAQ (${result.faqs.count} مورد — ${result.faqs.action})`);
  } else {
    console.log(`  ↷ FAQ (رد شد — از قبل موجود)`);
  }
  console.log('✅ محتوای عمومی seed شد.');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
