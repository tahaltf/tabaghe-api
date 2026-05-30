import { PrismaClient } from '@prisma/client';
import { seedPlatformContent } from './seed-data/seed-platform-content';

const prisma = new PrismaClient();

async function main() {
  await seedPlatformContent(prisma);
  console.log('✅ محتوای عمومی seed شد.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
