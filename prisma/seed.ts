import { PrismaClient, ListingType, LocationType } from '@prisma/client';
import { seedDigitalProductCategoryTree } from './seed-data/seed-digital-product-categories';

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

    const iranData = [
        { p: 'آذربایجان شرقی', c: ['تبریز', 'مراغه', 'مرند', 'میانه', 'اهر', 'بناب', 'سراب', 'آذرشهر'] },
        { p: 'آذربایجان غربی', c: ['ارومیه', 'خوی', 'بوکان', 'مهاباد', 'میاندوآب', 'سلماس', 'پیرانشهر', 'نقده'] },
        { p: 'اردبیل', c: ['اردبیل', 'پارس‌آباد', 'مشگین‌شهر', 'خلخال', 'گرمی', 'نمین'] },
        { p: 'اصفهان', c: ['اصفهان', 'کاشان', 'خمینی‌شهر', 'نجف‌آباد', 'شاهین‌شهر', 'شهرضا', 'فولادشهر', 'مبارکه'] },
        { p: 'البرز', c: ['کرج', 'فردیس', 'کمال‌شهر', 'نظرآباد', 'محمدشهر', 'هشتگرد', 'ماهدشت'] },
        { p: 'ایلام', c: ['ایلام', 'ایوان', 'دهلران', 'آبدانان', 'مهران'] },
        { p: 'بوشهر', c: ['بوشهر', 'برازجان', 'بندر کنگان', 'بندر گناوه', 'خورموج', 'جم', 'عسلویه'] },
        { p: 'تهران', c: ['تهران', 'اسلامشهر', 'شهریار', 'قدس', 'ملارد', 'گلستان', 'ورامین', 'قرچک', 'پاکدشت', 'پردیس'] },
        { p: 'چهارمحال و بختیاری', c: ['شهرکرد', 'بروجن', 'لردگان', 'فرخ‌شهر', 'فارسان'] },
        { p: 'خراسان جنوبی', c: ['بیرجند', 'قائنات', 'طبس', 'فردوس', 'نهبندان'] },
        { p: 'خراسان رضوی', c: ['مشهد', 'نیشابور', 'سبزوار', 'تربت حیدریه', 'قوچان', 'کاشمر', 'تایباد', 'چناران'] },
        { p: 'خراسان شمالی', c: ['بجنورد', 'شیروان', 'اسفراین', 'آشخانه', 'گرمه'] },
        { p: 'خوزستان', c: ['اهواز', 'دزفول', 'آبادان', 'بندر ماهشهر', 'خرمشهر', 'اندیمشک', 'ایذه', 'بهبهان', 'شوشتر'] },
        { p: 'زنجان', c: ['زنجان', 'ابهر', 'خرمدره', 'قیدار', 'هیدج'] },
        { p: 'سمنان', c: ['سمنان', 'شاهرود', 'دامغان', 'گرمسار', 'مهدی‌شهر'] },
        { p: 'سیستان و بلوچستان', c: ['زاهدان', 'زابل', 'ایرانشهر', 'چابهار', 'سراوان', 'خاش'] },
        { p: 'فارس', c: ['شیراز', 'مرودشت', 'جهرم', 'فسا', 'کازرون', 'صدرا', 'داراب', 'فیروزآباد', 'لار'] },
        { p: 'قزوین', c: ['قزوین', 'الوند', 'اقبالیه', 'تاکستان', 'آبیک', 'محمدیه'] },
        { p: 'قم', c: ['قم', 'قنوات', 'جعفریه', 'کهک'] },
        { p: 'کردستان', c: ['سنندج', 'سقز', 'مریوان', 'بانه', 'قروه', 'کامیاران', 'بیجار'] },
        { p: 'کرمان', c: ['کرمان', 'سیرجان', 'رفسنجان', 'جیرفت', 'بم', 'زرند', 'کهنوج'] },
        { p: 'کرمانشاه', c: ['کرمانشاه', 'اسلام‌آباد غرب', 'جوانرود', 'کنگاور', 'سرپل ذهاب', 'سنقر'] },
        { p: 'کهگیلویه و بویراحمد', c: ['یاسوج', 'دوگنبدان', 'دهدشت', 'لیکک', 'چرام'] },
        { p: 'گلستان', c: ['گرگان', 'گنبد کاووس', 'بندر ترکمن', 'علی‌آباد کتول', 'آزادشهر', 'کردکوی'] },
        { p: 'گیلان', c: ['رشت', 'بندر انزلی', 'لاهیجان', 'لنگرود', 'هشتپر', 'آستارا', 'صومعه‌سرا', 'رودسر'] },
        { p: 'لرستان', c: ['خرم‌آباد', 'بروجرد', 'دورود', 'کوهدشت', 'الیگودرز', 'نورآباد', 'ازنا'] },
        { p: 'مازندران', c: ['ساری', 'بابل', 'آمل', 'قائم‌شهر', 'بهشهر', 'چالوس', 'نکا', 'بابلسر', 'تنکابن'] },
        { p: 'مرکزی', c: ['اراک', 'ساوه', 'خمین', 'محلات', 'دلیجان', 'شازند'] },
        { p: 'هرمزگان', c: ['بندرعباس', 'میناب', 'دهبارز', 'قشم', 'کیش', 'بندر لنگه', 'حاجی‌آباد'] },
        { p: 'همدان', c: ['همدان', 'ملایر', 'نهاوند', 'اسدآباد', 'تویسرکان', 'بهار'] },
        { p: 'یزد', c: ['یزد', 'میبد', 'اردکان', 'بافق', 'مهریز', 'ابرکوه'] }
    ];

    if (listingCount === 0) {
        for (const item of iranData) {
            const province = await prisma.location.create({
                data: { name: item.p, type: LocationType.PROVINCE },
            });

            await prisma.location.createMany({
                data: item.c.map((cityName) => ({
                    name: cityName,
                    type: LocationType.CITY,
                    parentId: province.id,
                })),
            });
        }
    }

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
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
