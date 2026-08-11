-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN "excludedListingIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Coupon" ADD COLUMN "sellerId" TEXT;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "Coupon_sellerId_createdAt_idx" ON "Coupon"("sellerId", "createdAt");
