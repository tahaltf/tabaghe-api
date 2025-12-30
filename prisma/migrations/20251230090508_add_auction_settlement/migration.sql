-- CreateEnum
CREATE TYPE "AuctionSettlementStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'PENALIZED');

-- AlterTable
ALTER TABLE "ListingAuction" ADD COLUMN     "paymentDeadline" TIMESTAMP(3),
ADD COLUMN     "settlementStatus" "AuctionSettlementStatus" NOT NULL DEFAULT 'PENDING';
