-- DropIndex
DROP INDEX IF EXISTS "Order_listingId_key";

-- CreateIndex
CREATE INDEX "Order_listingId_createdAt_idx" ON "Order"("listingId", "createdAt");
