import { PrismaClient, ListingType } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // پاک‌سازی قبلی (اختیاری)
    await prisma.planRule.deleteMany();
    await prisma.plan.deleteMany();

    const basicPlan = await prisma.plan.create({
        data: {
            title: 'پلن پایه',
            description: 'مناسب کاربران عادی',
            price: 100000,
            isActive: true,
            rules: {
                create: [
                    {
                        type: ListingType.DIRECT,
                        count: 5,
                    },
                    {
                        type: ListingType.EXCHANGE,
                        count: 3,
                    },
                    {
                        type: ListingType.AUCTION,
                        count: 2,
                    },
                ],
            },
        },
    });

    const proPlan = await prisma.plan.create({
        data: {
            title: 'پلن حرفه‌ای',
            description: 'مناسب فروشندگان حرفه‌ای',
            price: 300000,
            isActive: true,
            rules: {
                create: [
                    {
                        type: ListingType.DIRECT,
                        count: 20,
                    },
                    {
                        type: ListingType.EXCHANGE,
                        count: 10,
                    },
                    {
                        type: ListingType.AUCTION,
                        count: 10,
                    },
                ],
            },
        },
    });

    console.log('✅ Plans seeded:', {
        basicPlan: basicPlan.id,
        proPlan: proPlan.id,
    });
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
