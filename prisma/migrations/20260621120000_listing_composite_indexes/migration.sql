-- CreateIndex
CREATE INDEX "Listing_status_categoryId_createdAt_idx" ON "Listing"("status", "categoryId", "createdAt");

-- CreateIndex
CREATE INDEX "Listing_status_type_createdAt_idx" ON "Listing"("status", "type", "createdAt");
