-- CreateEnum
CREATE TYPE "ShippingPayer" AS ENUM ('SELLER', 'BUYER_PREPAID', 'CASH_ON_DELIVERY');

-- AlterTable
ALTER TABLE "AuctionBid" ADD COLUMN     "blockedAmount" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "ListingAuction" ADD COLUMN     "secondBidderId" TEXT,
ADD COLUMN     "thirdBidderId" TEXT;

-- AlterTable
ALTER TABLE "ListingDirect" ADD COLUMN     "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'BUYER_PREPAID';

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN     "referenceId" TEXT;

-- AddForeignKey
ALTER TABLE "ListingAuction" ADD CONSTRAINT "ListingAuction_secondBidderId_fkey" FOREIGN KEY ("secondBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingAuction" ADD CONSTRAINT "ListingAuction_thirdBidderId_fkey" FOREIGN KEY ("thirdBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
