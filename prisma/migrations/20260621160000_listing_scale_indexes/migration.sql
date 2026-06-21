-- Phase 4: partial indexes for public catalog + trigram search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Approved-only partial indexes (smaller, faster for /listings)
CREATE INDEX "Listing_approved_category_createdAt_idx"
  ON "Listing"("categoryId", "createdAt" DESC)
  WHERE "status" = 'APPROVED';

CREATE INDEX "Listing_approved_type_createdAt_idx"
  ON "Listing"("type", "createdAt" DESC)
  WHERE "status" = 'APPROVED';

CREATE INDEX "Listing_approved_province_city_idx"
  ON "Listing"("provinceId", "cityId")
  WHERE "status" = 'APPROVED';

CREATE INDEX "Listing_title_trgm_idx"
  ON "Listing" USING GIN ("title" gin_trgm_ops);

CREATE INDEX "Listing_description_trgm_idx"
  ON "Listing" USING GIN ("description" gin_trgm_ops);
