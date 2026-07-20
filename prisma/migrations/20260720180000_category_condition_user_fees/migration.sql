-- AlterTable: condition-specific category fee percentages
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feePercentageDirectNew" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feePercentageDirectUsed" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feePercentageAuctionNew" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feePercentageAuctionUsed" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "auctionDepositPercentNew" DOUBLE PRECISION NOT NULL DEFAULT 10.0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "auctionDepositPercentUsed" DOUBLE PRECISION NOT NULL DEFAULT 10.0;

-- Seed New/Used from existing single-value columns so they start identical
UPDATE "Category" SET
  "feePercentageDirectNew" = COALESCE("feePercentageDirect", "feePercentage", 5.0),
  "feePercentageDirectUsed" = COALESCE("feePercentageDirect", "feePercentage", 5.0),
  "feePercentageAuctionNew" = COALESCE("feePercentageAuction", "feePercentage", 5.0),
  "feePercentageAuctionUsed" = COALESCE("feePercentageAuction", "feePercentage", 5.0),
  "auctionDepositPercentNew" = COALESCE("auctionDepositPercent", 10.0),
  "auctionDepositPercentUsed" = COALESCE("auctionDepositPercent", 10.0);

-- CreateTable: per-user category fee overrides
CREATE TABLE IF NOT EXISTS "UserCategoryFee" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "feePercentageDirectNew" DOUBLE PRECISION,
    "feePercentageDirectUsed" DOUBLE PRECISION,
    "feePercentageAuctionNew" DOUBLE PRECISION,
    "feePercentageAuctionUsed" DOUBLE PRECISION,
    "auctionDepositPercentNew" DOUBLE PRECISION,
    "auctionDepositPercentUsed" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserCategoryFee_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserCategoryFee_userId_categoryId_key" ON "UserCategoryFee"("userId", "categoryId");
CREATE INDEX IF NOT EXISTS "UserCategoryFee_categoryId_idx" ON "UserCategoryFee"("categoryId");

ALTER TABLE "UserCategoryFee" DROP CONSTRAINT IF EXISTS "UserCategoryFee_userId_fkey";
ALTER TABLE "UserCategoryFee" ADD CONSTRAINT "UserCategoryFee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserCategoryFee" DROP CONSTRAINT IF EXISTS "UserCategoryFee_categoryId_fkey";
ALTER TABLE "UserCategoryFee" ADD CONSTRAINT "UserCategoryFee_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
