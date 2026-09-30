-- استان و شهر پیشنهاددهنده روی پیشنهاد خرید
ALTER TABLE "PurchaseOffer" ADD COLUMN IF NOT EXISTS "province" TEXT;
ALTER TABLE "PurchaseOffer" ADD COLUMN IF NOT EXISTS "city" TEXT;
