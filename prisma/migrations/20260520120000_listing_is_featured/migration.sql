-- AlterTable: add featured fields to Listing
ALTER TABLE "Listing"
  ADD COLUMN "isFeatured" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "featuredAt" TIMESTAMP(3);

-- CreateIndex for sorting featured listings first
CREATE INDEX "Listing_isFeatured_createdAt_idx" ON "Listing"("isFeatured", "createdAt");
