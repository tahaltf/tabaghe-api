-- CreateEnum
CREATE TYPE "VerificationFeeMode" AS ENUM ('FIXED', 'PERCENT');

-- CreateTable
CREATE TABLE "VerificationFeeRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT,
    "minPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxPrice" DECIMAL(65,30),
    "mode" "VerificationFeeMode" NOT NULL,
    "feeValue" DECIMAL(65,30) NOT NULL,
    "feeCap" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerificationFeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationFeeRule_categoryId_isActive_minPrice_idx" ON "VerificationFeeRule"("categoryId", "isActive", "minPrice");

-- AddForeignKey
ALTER TABLE "VerificationFeeRule" ADD CONSTRAINT "VerificationFeeRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed one global FIXED rule from current VERIFICATION_FEE (or 250000)
INSERT INTO "VerificationFeeRule" ("id", "categoryId", "minPrice", "maxPrice", "mode", "feeValue", "feeCap", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  NULL,
  0,
  NULL,
  'FIXED'::"VerificationFeeMode",
  CASE
    WHEN (SELECT "value" FROM "SystemSetting" WHERE "key" = 'VERIFICATION_FEE' LIMIT 1) ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (SELECT "value" FROM "SystemSetting" WHERE "key" = 'VERIFICATION_FEE' LIMIT 1)::DECIMAL
    ELSE 250000
  END,
  NULL,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "VerificationFeeRule" LIMIT 1);
