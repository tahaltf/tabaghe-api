import { PrismaClient, ListingType, LocationType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('🚀 شروع عملیات جامع Seed برای استارتاپ طبقه...');

    // ۱. پاک‌سازی داده‌های قبلی برای جلوگیری از تداخل
    await prisma.userPlanPurchase.deleteMany();
    await prisma.planRule.deleteMany();
    await prisma.plan.deleteMany();
    await prisma.category.deleteMany();
    await prisma.location.deleteMany();

    // ۲. وارد کردن ۳۱ استان ایران به همراه شهرهای اصلی
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

    for (const item of iranData) {
        const province = await prisma.location.create({
            data: { name: item.p, type: LocationType.PROVINCE }
        });

        await prisma.location.createMany({
            data: item.c.map(cityName => ({
                name: cityName,
                type: LocationType.CITY,
                parentId: province.id
            }))
        });
    }

    // ۳. وارد کردن دسته‌بندی‌ها
    const categories = [
        { title: 'کالای دیجیتال', slug: 'digital' },
        { title: 'خودرو', slug: 'vehicles' },
        { title: 'املاک', slug: 'real-estate' },
        { title: 'لوازم خانگی', slug: 'home-appliances' },
        { title: 'مد و پوشاک', slug: 'fashion' },
        { title: 'ورزش و سرگرمی', slug: 'sports' }
    ];

    for (const cat of categories) {
        await prisma.category.create({ data: { title: cat.title, slug: cat.slug } });
    }

    // ۴. سهمیهٔ رایگان فروش مستقیم (پلن رایگان در API به‌صورت خودکار به لیست اضافه می‌شود)
    await prisma.systemSetting.upsert({
        where: { key: 'FREE_DIRECT_QUOTA' },
        create: { key: 'FREE_DIRECT_QUOTA', value: '3' },
        update: { value: '3' },
    });

    // ۵. پلن‌های پولی (نام و توضیح برای جذابیت بیزینسی)
    const paidPlans: Array<{
        title: string;
        marketingTitle: string;
        description: string;
        price: number;
        durationDays: number;
        feeDiscountDirectPercent: number;
        feeDiscountAuctionPercent: number;
        direct: number;
        exchange: number;
        auction: number;
    }> = [
        {
            title: 'پلن استارتر',
            marketingTitle: 'شروع کسب‌وکار — قیمت دانش‌جویی',
            description:
                'مناسب کسانی که می‌خواهند فعالیت جدی در طبقه را با هزینهٔ کم شروع کنند؛ کمی فراتر از پلن رایگان.',
            price: 199_000,
            durationDays: 180,
            feeDiscountDirectPercent: 0,
            feeDiscountAuctionPercent: 0,
            direct: 5,
            exchange: 3,
            auction: 2,
        },
        {
            title: 'پلن فروشنده',
            marketingTitle: 'اولین طبقه — دیده شو، بفروش',
            description:
                'برای کسی که می‌خواهد بیشتر دیده شود: سهمیهٔ معاوضه و مزایده اضافه، مناسب فروش دوره‌ای.',
            price: 349_000,
            durationDays: 365,
            feeDiscountDirectPercent: 0,
            feeDiscountAuctionPercent: 3,
            direct: 8,
            exchange: 5,
            auction: 4,
        },
        {
            title: 'پلن رشد',
            marketingTitle: 'شتاب رشد — پیشنهاد ویژهٔ طبقه',
            description:
                'تعادل قیمت و حجم: برای فروشندگان فعال که هم فروش ثابت دارند هم حراج و معاوضه.',
            price: 799_000,
            durationDays: 365,
            feeDiscountDirectPercent: 5,
            feeDiscountAuctionPercent: 8,
            direct: 18,
            exchange: 12,
            auction: 10,
        },
        {
            title: 'پلن کسب‌وکار',
            marketingTitle: 'کسب‌وکارت را بزرگ کن',
            description:
                'برای کسب‌وکارهای متوسط با حجم آگهی بالا و نیاز به تخفیف کارمزد بیشتر در فروش مستقیم و مزایده.',
            price: 1_199_000,
            durationDays: 365,
            feeDiscountDirectPercent: 8,
            feeDiscountAuctionPercent: 12,
            direct: 28,
            exchange: 20,
            auction: 16,
        },
        {
            title: 'پلن حرفه‌ای',
            marketingTitle: 'سقف بازار — قدرت تمام‌عیار',
            description:
                'حداکثر دیده‌شدن و چرخش کالا؛ مناسب مغازه‌داران و فروشندگان پرحجم آنلاین.',
            price: 1_699_000,
            durationDays: 365,
            feeDiscountDirectPercent: 12,
            feeDiscountAuctionPercent: 15,
            direct: 45,
            exchange: 30,
            auction: 25,
        },
        {
            title: 'پلن سازمانی',
            marketingTitle: 'مقیاس سازمانی — بدون محدودیت عملی',
            description:
                'برای فروشگاه‌های زنجیره‌ای و آژانس‌ها؛ سهمیهٔ بسیار بالا، بیشترین تخفیف کارمزد و اولویت پشتیبانی.',
            price: 2_999_000,
            durationDays: 365,
            feeDiscountDirectPercent: 18,
            feeDiscountAuctionPercent: 22,
            direct: 100,
            exchange: 70,
            auction: 60,
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

    console.log('✅ دیتابیس با موفقیت و دیتای کامل Seed شد!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());