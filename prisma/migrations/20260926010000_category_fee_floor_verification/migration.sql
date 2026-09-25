-- Category: min fee floors + verification toggle
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feeFloor" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feeFloorDirect" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "feeFloorAuction" DECIMAL(65,30) NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN IF NOT EXISTS "verificationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- VerificationFeeRule: min fee for PERCENT mode
ALTER TABLE "VerificationFeeRule" ADD COLUMN IF NOT EXISTS "feeFloor" DECIMAL(65,30);

-- Digital product tree: 3%, floor 100_000, cap 5_000_000
WITH RECURSIVE digital AS (
  SELECT id FROM "Category"
  WHERE slug IN (
    'mobile-tablet',
    'computer-laptop',
    'gaming-console',
    'camera-content-creation',
    'audio-video',
    'network-storage',
    'smart-wearables',
    'office-industrial-digital'
  )
  UNION ALL
  SELECT c.id
  FROM "Category" c
  INNER JOIN digital d ON c."parentId" = d.id
)
UPDATE "Category"
SET
  "feePercentage" = 3,
  "feePercentageDirect" = 3,
  "feePercentageAuction" = 3,
  "feePercentageDirectNew" = 3,
  "feePercentageDirectUsed" = 3,
  "feePercentageAuctionNew" = 3,
  "feePercentageAuctionUsed" = 3,
  "feeFloor" = 100000,
  "feeFloorDirect" = 100000,
  "feeFloorAuction" = 100000,
  "feeCap" = 5000000,
  "feeCapDirect" = 5000000,
  "feeCapAuction" = 5000000
WHERE id IN (SELECT id FROM digital);
