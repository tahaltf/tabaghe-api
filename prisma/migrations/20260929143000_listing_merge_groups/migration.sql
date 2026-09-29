-- CreateEnum
CREATE TYPE "ListingMergeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "ListingMergeGroup" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingMergeGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListingMergeRequest" (
    "id" TEXT NOT NULL,
    "sourceListingId" TEXT NOT NULL,
    "requestedTargetListingId" TEXT NOT NULL,
    "finalTargetListingId" TEXT,
    "requesterId" TEXT NOT NULL,
    "status" "ListingMergeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingMergeRequest_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "mergeGroupId" TEXT;

-- CreateIndex
CREATE INDEX "Listing_mergeGroupId_idx" ON "Listing"("mergeGroupId");

-- CreateIndex
CREATE INDEX "ListingMergeRequest_status_createdAt_idx" ON "ListingMergeRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ListingMergeRequest_requesterId_createdAt_idx" ON "ListingMergeRequest"("requesterId", "createdAt");

-- CreateIndex
CREATE INDEX "ListingMergeRequest_sourceListingId_status_idx" ON "ListingMergeRequest"("sourceListingId", "status");

-- CreateIndex
CREATE INDEX "ListingMergeRequest_requestedTargetListingId_idx" ON "ListingMergeRequest"("requestedTargetListingId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_mergeGroupId_fkey" FOREIGN KEY ("mergeGroupId") REFERENCES "ListingMergeGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMergeRequest" ADD CONSTRAINT "ListingMergeRequest_sourceListingId_fkey" FOREIGN KEY ("sourceListingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMergeRequest" ADD CONSTRAINT "ListingMergeRequest_requestedTargetListingId_fkey" FOREIGN KEY ("requestedTargetListingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMergeRequest" ADD CONSTRAINT "ListingMergeRequest_finalTargetListingId_fkey" FOREIGN KEY ("finalTargetListingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMergeRequest" ADD CONSTRAINT "ListingMergeRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingMergeRequest" ADD CONSTRAINT "ListingMergeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
