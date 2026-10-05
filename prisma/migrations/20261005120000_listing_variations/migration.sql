-- محصول متغیر: تنوع‌های قیمت/موجودی زیر آگهی فروش مستقیم
ALTER TABLE "Listing" ADD COLUMN "isVariable" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "ListingVariation" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(65,30) NOT NULL,
    "compareAtPrice" DECIMAL(65,30),
    "salePrice" DECIMAL(65,30),
    "stockQuantity" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "attributes" JSONB NOT NULL,
    "attributeKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListingVariation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ListingVariation_listingId_attributeKey_key" ON "ListingVariation"("listingId", "attributeKey");
CREATE INDEX "ListingVariation_listingId_isActive_idx" ON "ListingVariation"("listingId", "isActive");

ALTER TABLE "ListingVariation" ADD CONSTRAINT "ListingVariation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Order" ADD COLUMN "variationId" TEXT;
ALTER TABLE "Order" ADD COLUMN "variationLabel" TEXT;
CREATE INDEX "Order_variationId_idx" ON "Order"("variationId");
ALTER TABLE "Order" ADD CONSTRAINT "Order_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "ListingVariation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD COLUMN "variationId" TEXT;
ALTER TABLE "CartItem" ADD COLUMN "variationKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "CartItem" DROP CONSTRAINT "CartItem_cartId_listingId_key";
CREATE UNIQUE INDEX "CartItem_cartId_listingId_variationKey_key" ON "CartItem"("cartId", "listingId", "variationKey");
CREATE INDEX "CartItem_variationId_idx" ON "CartItem"("variationId");
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variationId_fkey" FOREIGN KEY ("variationId") REFERENCES "ListingVariation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
