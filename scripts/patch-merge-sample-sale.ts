/**
 * Patch existing [MERGE-SAMPLE] listings so فروشنده ب has an active sale price.
 *
 * Usage (from tabaghe-api, with DATABASE_URL set):
 *   npx ts-node scripts/patch-merge-sample-sale.ts
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

for (const name of ['.env', '.env.local', '.env.development', '.env.production']) {
  const p = resolve(process.cwd(), name);
  if (existsSync(p)) loadEnv({ path: p, override: false });
}

const prisma = new PrismaClient();

const MARKER = '[MERGE-SAMPLE]';
const BASE = 39_900_000;
const SALE = 34_900_000;

async function main() {
  const targets = await prisma.listing.findMany({
    where: {
      title: { startsWith: MARKER },
      OR: [
        { title: { contains: 'فروشنده ب' } },
        { title: { contains: 'تخفیف' } },
        { author: { phone: '09191110002' } },
        { direct: { price: BASE } },
      ],
    },
    select: {
      id: true,
      title: true,
      direct: { select: { price: true, salePrice: true, compareAtPrice: true } },
    },
  });

  if (!targets.length) {
    console.error('No MERGE-SAMPLE listing found to patch. Run seed-merge-sample-listings.ts first.');
    process.exit(1);
  }

  for (const row of targets) {
    await prisma.listingDirect.update({
      where: { listingId: row.id },
      data: {
        price: BASE,
        salePrice: SALE,
        compareAtPrice: BASE,
      },
    });
    await prisma.listing.update({
      where: { id: row.id },
      data: {
        title: `${MARKER} آیفون ۱۳ ۲۵۶ گیگ آبی — فروشنده ب (تخفیف)`,
      },
    });
    console.log(`Patched ${row.id}`);
    console.log(`  was: price=${row.direct?.price} sale=${row.direct?.salePrice}`);
    console.log(`  now: price=${BASE} salePrice=${SALE} compareAt=${BASE}`);
    console.log(`  open: /listing/${row.id}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
