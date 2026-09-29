/**
 * Seed sample merged iPhone 13 listings for manual QA of similar-products UI.
 *
 * Usage (from tabaghe-api):
 *   npx ts-node -r dotenv/config scripts/seed-merge-sample-listings.ts dotenv_config_path=.env.development
 *
 * Requires DATABASE_URL and existing Category + Location rows.
 */
import { config as loadEnv } from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';
import {
  ItemCondition,
  ListingStatus,
  ListingType,
  PrismaClient,
  UserRole,
  UserStatus,
} from '@prisma/client';

for (const name of ['.env.development', '.env', '.env.local']) {
  const p = resolve(process.cwd(), name);
  if (existsSync(p)) {
    loadEnv({ path: p, override: false });
    break;
  }
}

const prisma = new PrismaClient();

const MARKER = '[MERGE-SAMPLE]';

const SAMPLES: Array<{
  title: string;
  price: number;
  salePrice?: number;
  condition: ItemCondition;
  stockQuantity: number;
  phone: string;
  firstName: string;
  lastName: string;
}> = [
  {
    title: `${MARKER} آیفون ۱۳ ۲۵۶ گیگ مشکی — فروشنده الف`,
    price: 42_500_000,
    condition: ItemCondition.USED,
    stockQuantity: 1,
    phone: '09191110001',
    firstName: 'علی',
    lastName: 'نمونه',
  },
  {
    title: `${MARKER} آیفون ۱۳ ۲۵۶ گیگ آبی — فروشنده ب (تخفیف)`,
    price: 39_900_000,
    salePrice: 34_900_000,
    condition: ItemCondition.USED,
    stockQuantity: 1,
    phone: '09191110002',
    firstName: 'رضا',
    lastName: 'نمونه',
  },
  {
    title: `${MARKER} آیفون ۱۳ ۲۵۶ گیگ سفید — فروشنده ج (نو)`,
    price: 48_000_000,
    condition: ItemCondition.NEW,
    stockQuantity: 2,
    phone: '09191110003',
    firstName: 'سارا',
    lastName: 'نمونه',
  },
  {
    title: `${MARKER} آیفون ۱۳ ۲۵۶ گیگ — ناموجود (نباید در جدول بیاید)`,
    price: 35_000_000,
    condition: ItemCondition.USED,
    stockQuantity: 0,
    phone: '09191110004',
    firstName: 'مینا',
    lastName: 'نمونه',
  },
];

async function upsertSeller(phone: string, firstName: string, lastName: string) {
  const user = await prisma.user.upsert({
    where: { phone },
    create: {
      phone,
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      role: UserRole.USER,
      status: UserStatus.APPROVED,
      isVerified: true,
      isActive: true,
      trustScore: 100,
      termsAcceptedAt: new Date(),
      sellerTermsAcceptedAt: new Date(),
    },
    update: {
      firstName,
      lastName,
      displayName: `${firstName} ${lastName}`,
      status: UserStatus.APPROVED,
      isVerified: true,
      isActive: true,
    },
  });
  await prisma.wallet.upsert({
    where: { userId: user.id },
    create: { userId: user.id, balanceAvailable: 0, balanceBlocked: 0 },
    update: {},
  });
  return user;
}

async function main() {
  let category =
    (await prisma.category.findFirst({
      where: { title: { contains: 'موبایل', mode: 'insensitive' } },
      select: { id: true, title: true },
    })) ??
    (await prisma.category.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, title: true },
    }));
  if (!category) {
    category = await prisma.category.create({
      data: {
        title: 'موبایل (نمونه)',
        slug: `mobile-merge-sample-${Date.now()}`,
        isActive: true,
      },
      select: { id: true, title: true },
    });
    console.log('Created sample category:', category.title);
  }

  let province =
    (await prisma.location.findFirst({
      where: { type: 'PROVINCE', name: { contains: 'تهران' } },
      select: { id: true, name: true },
    })) ??
    (await prisma.location.findFirst({
      where: { type: 'PROVINCE' },
      select: { id: true, name: true },
    }));
  if (!province) {
    province = await prisma.location.create({
      data: { name: 'تهران', type: 'PROVINCE', slug: `tehran-p-${Date.now()}` },
      select: { id: true, name: true },
    });
  }

  let city =
    (await prisma.location.findFirst({
      where: { type: 'CITY', parentId: province.id },
      select: { id: true, name: true },
    })) ??
    (await prisma.location.findFirst({
      where: { type: 'CITY' },
      select: { id: true, name: true },
    }));
  if (!city) {
    city = await prisma.location.create({
      data: {
        name: 'تهران',
        type: 'CITY',
        parentId: province.id,
        slug: `tehran-c-${Date.now()}`,
      },
      select: { id: true, name: true },
    });
  }

  // پاکسازی نمونه‌های قبلی
  const old = await prisma.listing.findMany({
    where: { title: { startsWith: MARKER } },
    select: { id: true, mergeGroupId: true },
  });
  const oldGroupIds = [
    ...new Set(old.map((l) => l.mergeGroupId).filter((id): id is string => !!id)),
  ];
  if (old.length) {
    await prisma.listing.deleteMany({ where: { id: { in: old.map((l) => l.id) } } });
    console.log(`Removed ${old.length} previous sample listings.`);
  }
  if (oldGroupIds.length) {
    await prisma.listingMergeGroup.deleteMany({
      where: {
        id: { in: oldGroupIds },
        listings: { none: {} },
      },
    });
  }

  const group = await prisma.listingMergeGroup.create({ data: {} });
  const createdIds: string[] = [];

  for (const sample of SAMPLES) {
    const author = await upsertSeller(sample.phone, sample.firstName, sample.lastName);
    const listing = await prisma.listing.create({
      data: {
        authorId: author.id,
        type: ListingType.DIRECT,
        status: ListingStatus.APPROVED,
        title: sample.title,
        description: `${MARKER} نمونه تست ادغام — قیمت نمایشی برای QA جدول محصولات مشابه.`,
        condition: sample.condition,
        categoryId: category.id,
        provinceId: province.id,
        cityId: city.id,
        stockQuantity: sample.stockQuantity,
        singleItemSale: true,
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        mergeGroupId: group.id,
        thumbnail: null,
        gallery: [],
        direct: {
          create: {
            price: sample.price,
            salePrice: sample.salePrice ?? null,
            compareAtPrice: sample.salePrice != null ? sample.price : null,
            allowExchange: false,
            shippingMethods: ['POST'],
          },
        },
      },
      select: { id: true, title: true, stockQuantity: true },
    });
    createdIds.push(listing.id);
    const saleNote =
      sample.salePrice != null
        ? ` | SALE ${sample.salePrice.toLocaleString('en-US')} (was ${sample.price.toLocaleString('en-US')})`
        : '';
    console.log(
      `+ ${listing.id} | stock=${listing.stockQuantity}${saleNote} | ${listing.title}`,
    );
  }

  const activeSimilar = createdIds.slice(0, 3);
  console.log('\nMerge group:', group.id);
  console.log('Open one of these (active) to see the similar table:');
  for (const id of activeSimilar) {
    console.log(`  http://localhost:4200/listing/${id}`);
  }
  console.log(
    `\nOut-of-stock sample (should NOT appear in similar table): http://localhost:4200/listing/${createdIds[3]}`,
  );
  console.log(
    `\n*** Discounted sample (فروشنده ب / آبی): http://localhost:4200/listing/${createdIds[1]}`,
  );
  console.log(
    `    price=39,900,000  salePrice=34,900,000  → should show strikethrough + ~13%`,
  );
  console.log(`Category used: ${category.title} | ${city.name}, ${province.name}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
