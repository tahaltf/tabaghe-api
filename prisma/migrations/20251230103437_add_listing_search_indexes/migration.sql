-- CreateIndex
CREATE INDEX "Listing_province_city_idx" ON "Listing"("province", "city");

-- CreateIndex
CREATE INDEX "Listing_createdAt_idx" ON "Listing"("createdAt");
