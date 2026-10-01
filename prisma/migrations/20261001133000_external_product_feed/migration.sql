-- External product feed (was previously only in manual_external_product_feed.sql)
DO $$ BEGIN
  ALTER TYPE "ListingImportSource" ADD VALUE IF NOT EXISTS 'JSON_FEED';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ADMIN_ALERT_PRODUCT_FEED_SYNC';
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE TABLE IF NOT EXISTS "ExternalProductFeed" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "feedUrl" TEXT,
  "currencyCode" TEXT NOT NULL DEFAULT 'IRT',
  "markupType" TEXT NOT NULL DEFAULT 'NONE',
  "markupValue" DECIMAL(65,30) NOT NULL DEFAULT 0,
  "descriptionSuffix" TEXT,
  "defaultCategoryId" TEXT,
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "lastSyncError" TEXT,
  "lastSyncStats" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExternalProductFeed_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalProductFeed_userId_key" ON "ExternalProductFeed"("userId");

DO $$ BEGIN
  ALTER TABLE "ExternalProductFeed"
    ADD CONSTRAINT "ExternalProductFeed_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
