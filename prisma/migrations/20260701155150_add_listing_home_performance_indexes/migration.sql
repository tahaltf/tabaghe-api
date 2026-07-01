-- DropIndex
DROP INDEX "Listing_description_trgm_idx";

-- DropIndex
DROP INDEX "Listing_title_trgm_idx";

-- CreateIndex
CREATE INDEX "Ticket_lastMessageAt_idx" ON "Ticket"("lastMessageAt");
