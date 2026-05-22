-- پس از رد آگهی یا ارسال مجدد، فقط پیشنهادهای ثبت‌شده بعد از این زمان نمایش داده می‌شوند.
ALTER TABLE "Listing" ADD COLUMN "exchangeOffersSince" TIMESTAMP(3);

-- آگهی‌های تاییدشدهٔ فعلی: پیشنهادهای قبل از آخرین تایید را مخفی کن
UPDATE "Listing" l
SET "exchangeOffersSince" = l."approvedAt"
WHERE l."approvedAt" IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "ExchangeOffer" o WHERE o."listingId" = l.id
  );

-- آگهی‌های ردشده: از زمان رد به بعد دورهٔ جدید محسوب می‌شود
UPDATE "Listing" l
SET "exchangeOffersSince" = COALESCE(l."rejectedAt", l."updatedAt", NOW())
WHERE l.status = 'REJECTED'
  AND EXISTS (
    SELECT 1 FROM "ExchangeOffer" o WHERE o."listingId" = l.id
  );
