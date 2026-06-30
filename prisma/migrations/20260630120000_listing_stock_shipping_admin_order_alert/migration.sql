-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_ALERT_NEW_ORDER';

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "shippingCostOverride" INTEGER;
ALTER TABLE "Listing" ADD COLUMN "stockQuantity" INTEGER NOT NULL DEFAULT 1;
