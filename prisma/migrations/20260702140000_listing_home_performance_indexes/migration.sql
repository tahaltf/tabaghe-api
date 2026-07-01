-- CreateIndex
CREATE INDEX "Listing_status_deletedAt_cityId_idx" ON "Listing"("status", "deletedAt", "cityId");

-- CreateIndex
CREATE INDEX "Listing_status_deletedAt_provinceId_idx" ON "Listing"("status", "deletedAt", "provinceId");

-- CreateIndex
CREATE INDEX "Listing_status_isFeatured_featuredAt_createdAt_idx" ON "Listing"("status", "isFeatured", "featuredAt", "createdAt");
