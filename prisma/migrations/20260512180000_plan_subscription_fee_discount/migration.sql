-- اشتراک (مدت روز) + تخفیف درصدی از کارمزد محاسبه‌شده برای فروش مستقیم و مزایده

ALTER TABLE "Plan" ADD COLUMN "durationDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "Plan" ADD COLUMN "feeDiscountDirectPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Plan" ADD COLUMN "feeDiscountAuctionPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "UserPlanPurchase" ADD COLUMN "expiresAt" TIMESTAMP(3);

UPDATE "UserPlanPurchase" AS up
SET "expiresAt" = up."createdAt" + (COALESCE(p."durationDays", 365) * INTERVAL '1 day')
FROM "Plan" AS p
WHERE p."id" = up."planId" AND up."expiresAt" IS NULL;
