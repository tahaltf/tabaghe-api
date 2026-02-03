/*
  Warnings:

  - The values [CONFIRMED,REJECTED] on the enum `WalletTransactionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "WalletTransactionStatus_new" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');
ALTER TABLE "WalletTransaction" ALTER COLUMN "status" TYPE "WalletTransactionStatus_new" USING ("status"::text::"WalletTransactionStatus_new");
ALTER TYPE "WalletTransactionStatus" RENAME TO "WalletTransactionStatus_old";
ALTER TYPE "WalletTransactionStatus_new" RENAME TO "WalletTransactionStatus";
DROP TYPE "public"."WalletTransactionStatus_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AuctionBid" DROP CONSTRAINT "AuctionBid_bidderId_fkey";

-- DropForeignKey
ALTER TABLE "ExchangeOffer" DROP CONSTRAINT "ExchangeOffer_offererId_fkey";

-- DropForeignKey
ALTER TABLE "Listing" DROP CONSTRAINT "Listing_authorId_fkey";

-- DropForeignKey
ALTER TABLE "Notification" DROP CONSTRAINT "Notification_userId_fkey";

-- DropForeignKey
ALTER TABLE "QuotaLedger" DROP CONSTRAINT "QuotaLedger_userId_fkey";

-- DropForeignKey
ALTER TABLE "RepairRequest" DROP CONSTRAINT "RepairRequest_userId_fkey";

-- DropForeignKey
ALTER TABLE "Ticket" DROP CONSTRAINT "Ticket_userId_fkey";

-- DropForeignKey
ALTER TABLE "UserPlanPurchase" DROP CONSTRAINT "UserPlanPurchase_userId_fkey";

-- DropForeignKey
ALTER TABLE "Wallet" DROP CONSTRAINT "Wallet_userId_fkey";

-- DropForeignKey
ALTER TABLE "WalletTransaction" DROP CONSTRAINT "WalletTransaction_walletId_fkey";

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlanPurchase" ADD CONSTRAINT "UserPlanPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeOffer" ADD CONSTRAINT "ExchangeOffer_offererId_fkey" FOREIGN KEY ("offererId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepairRequest" ADD CONSTRAINT "RepairRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
