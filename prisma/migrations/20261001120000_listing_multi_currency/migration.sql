-- AlterTable User
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "allowedListingCurrencyCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable Listing
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "priceCurrencyCode" TEXT NOT NULL DEFAULT 'IRT';
ALTER TABLE "Listing" ADD COLUMN IF NOT EXISTS "priceTomanCached" DECIMAL(65,30);

-- AlterTable Order
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "priceCurrencyCode" TEXT NOT NULL DEFAULT 'IRT';
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "originalUnitPrice" DECIMAL(65,30);
ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "fxRateToToman" DECIMAL(65,30);

-- CreateTable Currency
CREATE TABLE IF NOT EXISTS "Currency" (
    "code" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "decimals" INTEGER NOT NULL DEFAULT 0,
    "navasanItem" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Currency_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "Currency_isEnabled_sortOrder_idx" ON "Currency"("isEnabled", "sortOrder");

-- CreateTable CurrencyRate
CREATE TABLE IF NOT EXISTS "CurrencyRate" (
    "currencyCode" TEXT NOT NULL,
    "rateToToman" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'navasan',
    "fetchedAt" TIMESTAMP(3),
    "manualOverride" DECIMAL(65,30),
    "overrideUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CurrencyRate_pkey" PRIMARY KEY ("currencyCode")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'CurrencyRate_currencyCode_fkey'
  ) THEN
    ALTER TABLE "CurrencyRate"
      ADD CONSTRAINT "CurrencyRate_currencyCode_fkey"
      FOREIGN KEY ("currencyCode") REFERENCES "Currency"("code")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Seed currencies
INSERT INTO "Currency" ("code", "nameFa", "symbol", "isEnabled", "sortOrder", "decimals", "navasanItem", "updatedAt")
VALUES
  ('IRT', 'تومان', 'تومان', true, 0, 0, NULL, NOW()),
  ('USD', 'دلار آمریکا', '$', false, 10, 2, 'usd', NOW()),
  ('AED', 'درهم امارات', 'د.إ', false, 20, 2, 'aed', NOW()),
  ('TRY', 'لیر ترکیه', '₺', false, 30, 2, 'try', NOW()),
  ('IQD', 'دینار عراق', 'د.ع', false, 40, 0, 'iqd', NOW())
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "CurrencyRate" ("currencyCode", "rateToToman", "source", "updatedAt")
VALUES
  ('IRT', 1, 'manual', NOW()),
  ('USD', 0, 'navasan', NOW()),
  ('AED', 0, 'navasan', NOW()),
  ('TRY', 0, 'navasan', NOW()),
  ('IQD', 0, 'navasan', NOW())
ON CONFLICT ("currencyCode") DO NOTHING;

-- Backfill cached toman price for existing direct listings
UPDATE "Listing" l
SET "priceTomanCached" = CASE
  WHEN d."salePrice" IS NOT NULL AND d."salePrice" > 0 AND d."salePrice" < d."price"
    THEN d."salePrice"
  ELSE d."price"
END
FROM "ListingDirect" d
WHERE d."listingId" = l."id"
  AND l."priceTomanCached" IS NULL;

UPDATE "Listing" l
SET "priceTomanCached" = e."ownValue"
FROM "ListingExchange" e
WHERE e."listingId" = l."id"
  AND l."priceTomanCached" IS NULL
  AND l."type" = 'EXCHANGE';

UPDATE "Listing" l
SET "priceTomanCached" = a."basePrice"
FROM "ListingAuction" a
WHERE a."listingId" = l."id"
  AND l."priceTomanCached" IS NULL
  AND l."type" = 'AUCTION';
