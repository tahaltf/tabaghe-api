-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_EXPIRY_REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_EXPIRED';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "expiresAt" TIMESTAMP(3),
ADD COLUMN "expiryReminderSentAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Listing_status_expiresAt_idx" ON "Listing"("status", "expiresAt");
