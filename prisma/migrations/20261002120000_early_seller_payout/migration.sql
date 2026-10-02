-- AlterTable
ALTER TABLE "User" ADD COLUMN "payoutOnShipment" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "sellerEscrowReleasedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "sellerEscrowReleaseReason" TEXT;
