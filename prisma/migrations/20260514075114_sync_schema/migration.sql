/*
  Warnings:

  - The values [DRAFT] on the enum `ListingStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [SELLER,CASH_ON_DELIVERY] on the enum `ShippingPayer` will be removed. If these variants are still used in the database, this will fail.
  - The `status` column on the `Order` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Added the required column `updatedAt` to the `ExchangeOffer` table without a default value. This is not possible if the table is not empty.
  - Added the required column `sellerRevenue` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `totalAmount` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Added the required column `updatedAt` to the `Order` table without a default value. This is not possible if the table is not empty.
  - Made the column `finalPrice` on table `Order` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'AWAITING_PAYMENT', 'PAID', 'AWAITING_SHIPMENT_TO_HUB', 'SHIPPED_TO_HUB', 'RECEIVED_AT_HUB', 'CHECKING_AT_HUB', 'VERIFIED_AT_HUB', 'REJECTED_AT_HUB', 'SHIPPED_TO_BUYER', 'SHIPPED', 'DELIVERED', 'RETURN_REQUESTED', 'RETURN_SHIPPED', 'COMPLETED', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ExchangePayer" AS ENUM ('ME', 'BUYER', 'NONE');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('GATEWAY', 'WALLET');

-- CreateEnum
CREATE TYPE "SecondChanceOfferStatus" AS ENUM ('OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DisputeOutcome" AS ENUM ('REFUND_BUYER', 'RELEASE_SELLER', 'PARTIAL_REFUND', 'CANCEL');

-- AlterEnum
BEGIN;
CREATE TYPE "ListingStatus_new" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SOLD', 'ARCHIVED', 'DELETED_BY_USER');
ALTER TABLE "public"."Listing" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "status" TYPE "ListingStatus_new" USING ("status"::text::"ListingStatus_new");
ALTER TYPE "ListingStatus" RENAME TO "ListingStatus_old";
ALTER TYPE "ListingStatus_new" RENAME TO "ListingStatus";
DROP TYPE "public"."ListingStatus_old";
ALTER TABLE "Listing" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'ADMIN_ANNOUNCEMENT';
ALTER TYPE "NotificationType" ADD VALUE 'ORDER_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'KYC_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'KYC_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'LISTING_REJECTED';
ALTER TYPE "NotificationType" ADD VALUE 'REPAIR_STATUS_CHANGED';
ALTER TYPE "NotificationType" ADD VALUE 'TICKET_REPLY';
ALTER TYPE "NotificationType" ADD VALUE 'SYSTEM';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "RepairRequestStatus" ADD VALUE 'AWAITING_DELIVERY';
ALTER TYPE "RepairRequestStatus" ADD VALUE 'RECEIVED_AT_HUB';
ALTER TYPE "RepairRequestStatus" ADD VALUE 'UNDER_INSPECTION';
ALTER TYPE "RepairRequestStatus" ADD VALUE 'RESULT_READY';
ALTER TYPE "RepairRequestStatus" ADD VALUE 'READY_TO_SHIP';
ALTER TYPE "RepairRequestStatus" ADD VALUE 'SHIPPED_BACK';

-- AlterEnum
BEGIN;
CREATE TYPE "ShippingPayer_new" AS ENUM ('SELLER_PREPAID', 'BUYER_PREPAID', 'BUYER_POSTPAID');
ALTER TABLE "public"."Listing" ALTER COLUMN "shippingPayer" DROP DEFAULT;
ALTER TABLE "Listing" ALTER COLUMN "shippingPayer" TYPE "ShippingPayer_new" USING ("shippingPayer"::text::"ShippingPayer_new");
ALTER TYPE "ShippingPayer" RENAME TO "ShippingPayer_old";
ALTER TYPE "ShippingPayer_new" RENAME TO "ShippingPayer";
DROP TYPE "public"."ShippingPayer_old";
ALTER TABLE "Listing" ALTER COLUMN "shippingPayer" SET DEFAULT 'BUYER_PREPAID';
COMMIT;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WalletTransactionType" ADD VALUE 'COMMISSION_FEE';
ALTER TYPE "WalletTransactionType" ADD VALUE 'REFUND';

-- AlterTable
ALTER TABLE "Category" ADD COLUMN     "auctionDepositPercent" DOUBLE PRECISION NOT NULL DEFAULT 10.0,
ADD COLUMN     "feeCap" DECIMAL(65,30) NOT NULL DEFAULT 500000,
ADD COLUMN     "feeCapAuction" DECIMAL(65,30) NOT NULL DEFAULT 500000,
ADD COLUMN     "feeCapDirect" DECIMAL(65,30) NOT NULL DEFAULT 500000,
ADD COLUMN     "feePercentage" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
ADD COLUMN     "feePercentageAuction" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
ADD COLUMN     "feePercentageDirect" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "ExchangeOffer" ADD COLUMN     "isPayerMe" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "exchangePayer" "ExchangePayer" DEFAULT 'NONE',
ADD COLUMN     "sellerRequiresVerification" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "buyerConfirmedDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "buyerPackagingVideo" TEXT,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "disputeOutcome" "DisputeOutcome",
ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeResolution" TEXT,
ADD COLUMN     "disputeResolvedAt" TIMESTAMP(3),
ADD COLUMN     "disputeResolvedBy" TEXT,
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "hubToBuyerTrackingCode" TEXT,
ADD COLUMN     "hubToSellerTrackingCode" TEXT,
ADD COLUMN     "packagingVideo" TEXT,
ADD COLUMN     "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'GATEWAY',
ADD COLUMN     "platformAddress" TEXT,
ADD COLUMN     "platformFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "requiresVerification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "returnConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "returnConfirmedBy" TEXT,
ADD COLUMN     "returnPackagingVideo" TEXT,
ADD COLUMN     "returnShippedAt" TIMESTAMP(3),
ADD COLUMN     "returnTrackingCode" TEXT,
ADD COLUMN     "sellerConfirmedDelivery" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sellerRevenue" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "sellerShippingAddress" TEXT,
ADD COLUMN     "sellerShippingPhone" TEXT,
ADD COLUMN     "sellerShippingPostalCode" TEXT,
ADD COLUMN     "sellerTrackingCode" TEXT,
ADD COLUMN     "sellerUnboxingVideo" TEXT,
ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingCost" DECIMAL(65,30) NOT NULL DEFAULT 0,
ADD COLUMN     "shippingDeadline" TIMESTAMP(3),
ADD COLUMN     "shippingPhone" TEXT,
ADD COLUMN     "shippingPostalCode" TEXT,
ADD COLUMN     "totalAmount" DECIMAL(65,30) NOT NULL,
ADD COLUMN     "unboxingVideo" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL,
ADD COLUMN     "verificationFee" DECIMAL(65,30) NOT NULL DEFAULT 0,
ALTER COLUMN "finalPrice" SET NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "OrderStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "RepairRequest" ADD COLUMN     "adminNote" TEXT,
ADD COLUMN     "availableSlots" JSONB,
ADD COLUMN     "estimatedCost" DECIMAL(65,30),
ADD COLUMN     "inspectionResult" TEXT,
ADD COLUMN     "returnTrackingCode" TEXT,
ADD COLUMN     "returnVideo" TEXT,
ADD COLUMN     "shippingTrackingCode" TEXT,
ADD COLUMN     "shippingVideo" TEXT,
ADD COLUMN     "userCostApproved" BOOLEAN,
ADD COLUMN     "videos" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "kycRejectionReason" TEXT,
ADD COLUMN     "kycReviewedAt" TIMESTAMP(3),
ADD COLUMN     "shabaNumber" TEXT,
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "balanceCredit" DECIMAL(65,30) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "fullAddress" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecondChanceOffer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "status" "SecondChanceOfferStatus" NOT NULL DEFAULT 'OFFERED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecondChanceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedListing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeeRule" (
    "id" TEXT NOT NULL,
    "listingType" "ListingType" NOT NULL,
    "categoryId" TEXT,
    "minPrice" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "maxPrice" DECIMAL(65,30),
    "feePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "feeFixed" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "feeCap" DECIMAL(65,30),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "auctionDepositPercent" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeeRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "revieweeId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecondChanceOffer_listingId_createdAt_idx" ON "SecondChanceOffer"("listingId", "createdAt");

-- CreateIndex
CREATE INDEX "SecondChanceOffer_userId_createdAt_idx" ON "SecondChanceOffer"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SecondChanceOffer_listingId_userId_status_key" ON "SecondChanceOffer"("listingId", "userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SavedListing_userId_listingId_key" ON "SavedListing"("userId", "listingId");

-- CreateIndex
CREATE INDEX "FeeRule_listingType_categoryId_isActive_idx" ON "FeeRule"("listingType", "categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Review_orderId_reviewerId_key" ON "Review"("orderId", "reviewerId");

-- CreateIndex
CREATE INDEX "Faq_isActive_order_idx" ON "Faq"("isActive", "order");

-- CreateIndex
CREATE INDEX "Order_buyerId_status_idx" ON "Order"("buyerId", "status");

-- CreateIndex
CREATE INDEX "Order_sellerId_status_idx" ON "Order"("sellerId", "status");

-- CreateIndex
CREATE INDEX "Order_status_disputedAt_idx" ON "Order"("status", "disputedAt");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "ListingAuction"("listingId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecondChanceOffer" ADD CONSTRAINT "SecondChanceOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedListing" ADD CONSTRAINT "SavedListing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedListing" ADD CONSTRAINT "SavedListing_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeRule" ADD CONSTRAINT "FeeRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_revieweeId_fkey" FOREIGN KEY ("revieweeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
