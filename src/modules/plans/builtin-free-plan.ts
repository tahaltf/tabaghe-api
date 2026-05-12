import { ListingType } from '@prisma/client';

/** شناسهٔ ثابت پلن رایگان سامانه (در دیتابیس ذخیره نمی‌شود). */
export const BUILTIN_FREE_PLAN_ID = 'builtin_free_plan';

export function buildBuiltinFreePlan(freeDirectLimit: number) {
  const id = BUILTIN_FREE_PLAN_ID;
  const now = new Date();
  return {
    id,
    title: 'پلن شروع (رایگان)',
    description:
      'بلافاصله پس از ثبت‌نام برای همه فعال است؛ بدون پرداخت، چند آگهی فروش مستقیم منتشر کنید و دیده شوید. برای معاوضه و مزایده، پلن‌های بالاتر را انتخاب کنید.',
    price: 0,
    isActive: true,
    durationDays: 0,
    feeDiscountDirectPercent: 0,
    feeDiscountAuctionPercent: 0,
    rules: [
      {
        id: `${id}_direct`,
        planId: id,
        type: ListingType.DIRECT,
        count: Math.max(0, Math.floor(freeDirectLimit)),
      },
    ],
    createdAt: now,
    updatedAt: now,
    isBuiltinFree: true as const,
  };
}
