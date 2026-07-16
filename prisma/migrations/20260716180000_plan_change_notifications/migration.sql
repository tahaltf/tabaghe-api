-- AlterEnum: plan lifecycle notifications
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'PLAN_EXPIRED';

-- AlterTable: track expiry notification per purchase
ALTER TABLE "UserPlanPurchase" ADD COLUMN "expiryNotifiedAt" TIMESTAMP(3);

CREATE INDEX "UserPlanPurchase_status_expiresAt_idx"
  ON "UserPlanPurchase"("status", "expiresAt");
