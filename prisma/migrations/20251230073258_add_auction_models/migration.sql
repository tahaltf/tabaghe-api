-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "AuctionBidStatus" AS ENUM ('ACTIVE', 'OUTBID', 'WON', 'LOST', 'CANCELLED');

-- AlterTable
ALTER TABLE "ListingAuction" ADD COLUMN     "highestBidAmount" DECIMAL(65,30),
ADD COLUMN     "highestBidderId" TEXT,
ADD COLUMN     "status" "AuctionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "AuctionBid" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "bidderId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "AuctionBidStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuctionBid_listingId_createdAt_idx" ON "AuctionBid"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "AuctionBid_bidderId_createdAt_idx" ON "AuctionBid"("bidderId", "createdAt");

-- CreateIndex
CREATE INDEX "AuctionBid_listingId_amount_idx" ON "AuctionBid"("listingId", "amount");

-- CreateIndex
CREATE INDEX "ListingAuction_status_endDatetime_idx" ON "ListingAuction"("status", "endDatetime");

-- AddForeignKey
ALTER TABLE "ListingAuction" ADD CONSTRAINT "ListingAuction_highestBidderId_fkey" FOREIGN KEY ("highestBidderId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ListingAuction"("listingId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuctionBid" ADD CONSTRAINT "AuctionBid_bidderId_fkey" FOREIGN KEY ("bidderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
