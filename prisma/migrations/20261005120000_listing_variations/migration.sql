-- محصول متغیر: تنوع‌های قیمت/موجودی روی آگهی فروش مستقیم
-- Idempotent: safe to re-run after a partial failure in production.

ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "isVariable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "ListingVariation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "compareAtPrice" DECIMAL(65,30),
    "salePrice" DECIMAL(65,30),
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "attributes" JSONB NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingVariation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ListingVariation_listingId_attributeKey_key"
  ON "ListingVariation"("listingId", "attributeKey");
CREATE INDEX IF NOT EXISTS "ListingVariation_listingId_isActive_idx"
  ON "ListingVariation"("listingId", "isActive");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ListingVariation_listingId_fkey'
  ) THEN
    ALTER TABLE "ListingVariation"
      ADD CONSTRAINT "ListingVariation_listingId_fkey"
      FOREIGN KEY ("listingId") REFERENCES "Listing"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "variationId" TEXT;
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "variationLabel" TEXT;
CREATE INDEX IF NOT EXISTS "Order_variationId_idx" ON "Order"("variationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Order_variationId_fkey'
  ) THEN
    ALTER TABLE "Order"
      ADD CONSTRAINT "Order_variationId_fkey"
      FOREIGN KEY ("variationId") REFERENCES "ListingVariation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "variationId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN IF NOT EXISTS "variationKey" TEXT NOT NULL DEFAULT '';

-- Original cart migration created a UNIQUE INDEX (not a table CONSTRAINT).
ALTER TABLE "CartItem" DROP CONSTRAINT IF EXISTS "CartItem_cartId_listingId_key";
DROP INDEX IF EXISTS "CartItem_cartId_listingId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "CartItem_cartId_listingId_variationKey_key"
  ON "CartItem"("cartId", "listingId", "variationKey");
CREATE INDEX IF NOT EXISTS "CartItem_variationId_idx" ON "CartItem"("variationId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CartItem_variationId_fkey'
  ) THEN
    ALTER TABLE "CartItem"
      ADD CONSTRAINT "CartItem_variationId_fkey"
      FOREIGN KEY ("variationId") REFERENCES "ListingVariation"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
