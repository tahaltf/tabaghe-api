-- CreateEnum
CREATE TYPE "BankAccountVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "UserBankAccount"
  ADD COLUMN IF NOT EXISTS "verificationStatus" "BankAccountVerificationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "rejectionReason" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reviewedByAdminId" TEXT;

-- Backfill previously auto-verified accounts
UPDATE "UserBankAccount"
SET "verificationStatus" = 'APPROVED'
WHERE "verifiedAt" IS NOT NULL AND "deletedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserBankAccount_verificationStatus_idx"
  ON "UserBankAccount"("verificationStatus");
