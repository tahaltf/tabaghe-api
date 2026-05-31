import { PrismaClient } from '@prisma/client';
import { seedPlatformContent } from '../src/common/content/platform-content.seed';

const prisma = new PrismaClient();

async function main() {
  console.log('📄 Seed محتوای عمومی (قوانین، درباره ما، معرفی، FAQ)...');
  const result = await seedPlatformContent(prisma);
  for (const s of result.settings) {
    if (s.action !== 'skipped') console.log(`  ✓ ${s.key} (${s.action})`);
  }
  if (result.faqs.action !== 'skipped') {
    console.log(`  ✓ FAQ (${result.faqs.count} مورد — ${result.faqs.action})`);
  } else {
    console.log('  ↷ FAQ (رد شد — از قبل موجود)');
  }
  console.log('✅ محتوای عمومی seed شد.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
