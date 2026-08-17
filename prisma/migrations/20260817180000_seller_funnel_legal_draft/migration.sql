-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE IF NOT EXISTS 'DRAFT';

-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "termsAcceptedVersion" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerTermsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "sellerTermsAcceptedVersion" TEXT;
