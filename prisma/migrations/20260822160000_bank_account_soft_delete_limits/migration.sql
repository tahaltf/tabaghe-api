-- AlterTable
ALTER TABLE "UserInquiryRestriction" ADD COLUMN IF NOT EXISTS "maxBankAccounts" INTEGER;

-- AlterTable
ALTER TABLE "UserBankAccount" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "UserBankAccount_userId_deletedAt_idx" ON "UserBankAccount"("userId", "deletedAt");
CREATE INDEX IF NOT EXISTS "UserBankAccount_userId_bankCardNumber_idx" ON "UserBankAccount"("userId", "bankCardNumber");
