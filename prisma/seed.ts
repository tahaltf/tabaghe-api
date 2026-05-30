import { PrismaClient, ListingType, LocationType } from '@prisma/client';
import { seedDigitalProductCategoryTree } from './seed-data/seed-digital-product-categories';
import { seedPlatformContent } from './seed-data/seed-platform-content';
import { IRAN_LOCATION_SEED } from './seed-data/iran-locations';
import { syncIranLocationSlugs } from '../src/common-module/location-slug.util';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 شروع عملیات جامع Seed برای استارتاپ طبقه...');

    const listingCount = await prisma.listing.count();

    // ۱. پاک‌سازی داده‌های قبلی برای جلوگیری از تداخل
    await prisma.userPlanPurchase.deleteMany();
    await prisma.planRule.deleteMany();
    await prisma.plan.deleteMany();

    if (listingCount === 0) {
        await prisma.location.deleteMany();
    } else {
        console.warn(
            '⚠️ به‌خاطر وجود آگهی، حذف کامل استان/شهر انجام نمی‌شود (RESTRICT روی Listing). دسته‌ها فقط با upsert به‌روز می‌شوند.',
        );
    }

    if (listingCount === 0) {
        for (const item of IRAN_LOCATION_SEED) {
            const province = await prisma.location.create({
                data: {
                    name: item.name,
                    slug: item.slug,
                    type: LocationType.PROVINCE,
                },
            });

            await prisma.location.createMany({
                data: item.cities.map((city) => ({
                    name: city.name,
                    slug: city.slug,
                    type: LocationType.CITY,
                    parentId: province.id,
                })),
            });
        }
    }

    await syncIranLocationSlugs(prisma);

    await seedDigitalProductCategoryTree(prisma);

    const otherTopCategories = [
        { title: 'خودرو', slug: 'vehicles' },
        { title: 'املاک', slug: 'real-estate' },
        { title: 'لوازم خانگی', slug: 'home-appliances' },
        { title: 'مد و پوشاک', slug: 'fashion' },
        { title: 'ورزش و سرگرمی', slug: 'sports' },
    ];

    for (const cat of otherTopCategories) {
        await prisma.category.upsert({
            where: { slug: cat.slug },
            create: { title: cat.title, slug: cat.slug },
            update: { title: cat.title },
        });
    }

    // ۴. پلن همکف (رایگان) — سهمیه + متن نمایش
    await prisma.systemSetting.upsert({
        where: { key: 'FREE_DIRECT_QUOTA' },
        create: {
            key: 'FREE_DIRECT_QUOTA',
            value: '2',
            description: 'سهمیه فروش مستقیم رایگان (همکف)',
        },
        update: { value: '2' },
    });

    await prisma.systemSetting.upsert({
        where: { key: 'FREE_EXCHANGE_QUOTA' },
        create: {
            key: 'FREE_EXCHANGE_QUOTA',
            value: '1',
            description: 'سهمیه معاوضه رایگان (همکف)',
        },
        update: { value: '1' },
    });

    await prisma.systemSetting.upsert({
        where: { key: 'BUILTIN_FREE_PLAN_DISPLAY' },
        create: {
            key: 'BUILTIN_FREE_PLAN_DISPLAY',
            value: JSON.stringify({
                title: 'همکف',
                marketingTitle: 'شروع معامله در طبقه',
                description:
                    'ورودی بازار طبقه — برای همه فعال است. مناسب اولین معامله و آشنایی با بازار.',
                isActive: true,
            }),
            description: 'تنظیمات نمایش پلن همکف (JSON)',
        },
        update: {
            value: JSON.stringify({
                title: 'همکف',
                marketingTitle: 'شروع معامله در طبقه',
                description:
                    'ورودی بازار طبقه — برای همه فعال است. مناسب اولین معامله و آشنایی با بازار.',
                isActive: true,
            }),
        },
    });

    // ۵. دو پلن پولی: بالکن (ستاره) + پنت‌هاوس
    const paidPlans: Array<{
        title: string;
        marketingTitle: string;
        description: string;
        price: number;
        durationDays: number;
        feeDiscountDirectPercent: number;
        feeDiscountAuctionPercent: number;
        badgeLabel: string | null;
        badgeColor: string | null;
        direct: number;
        exchange: number;
        auction: number;
    }> = [
        {
            title: 'بالکن',
            marketingTitle: 'معامله بیشتر، هزینه کمتر',
            description:
                'مناسب اکثر کاربران طبقه — بهترین انتخاب برای خرید و فروش روزانه.',
            price: 299_000,
            durationDays: 30,
            feeDiscountDirectPercent: 10,
            feeDiscountAuctionPercent: 10,
            badgeLabel: 'محبوب‌ترین انتخاب',
            badgeColor: '#f97316',
            direct: 15,
            exchange: 5,
            auction: 5,
        },
        {
            title: 'پنت‌هاوس',
            marketingTitle: 'نهایت قدرت معامله در طبقه',
            description:
                'برای فروشنده حرفه‌ای؛ حجم بالا، تخفیف کارمزد بیشتر و حس VIP.',
            price: 799_000,
            durationDays: 30,
            feeDiscountDirectPercent: 30,
            feeDiscountAuctionPercent: 30,
            badgeLabel: null,
            badgeColor: null,
            direct: 50,
            exchange: 20,
            auction: 20,
        },
    ];

    for (const p of paidPlans) {
        await prisma.plan.create({
            data: {
                title: p.title,
                marketingTitle: p.marketingTitle,
                description: p.description,
                price: p.price,
                isActive: true,
                durationDays: p.durationDays,
                feeDiscountDirectPercent: p.feeDiscountDirectPercent,
                feeDiscountAuctionPercent: p.feeDiscountAuctionPercent,
                badgeLabel: p.badgeLabel,
                badgeColor: p.badgeColor,
                rules: {
                    create: [
                        { type: ListingType.DIRECT, count: p.direct },
                        { type: ListingType.EXCHANGE, count: p.exchange },
                        { type: ListingType.AUCTION, count: p.auction },
                    ],
                },
            },
        });
    }

    console.log('✅ دیتابیس با موفقیت Seed شد — ساختار ۳ پلن: همکف + بالکن + پنت‌هاوس');

    await seedPlatformContent(prisma);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
