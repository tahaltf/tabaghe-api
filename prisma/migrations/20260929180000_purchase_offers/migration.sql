-- Purchase offers (پیشنهاد خرید) for DIRECT listings + cart reservation

CREATE TYPE "PurchaseOfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_OFFER_RECEIVED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_OFFER_ACCEPTED';
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'PURCHASE_OFFER_REJECTED';

CREATE TABLE "PurchaseOffer" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "amount" DECIMAL(65,30) NOT NULL,
    "description" TEXT,
    "status" "PurchaseOfferStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "reservedUntil" TIMESTAMP(3),
    "prevSalePrice" DECIMAL(65,30),
    "prevCompareAtPrice" DECIMAL(65,30),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseOffer_listingId_status_idx" ON "PurchaseOffer"("listingId", "status");
CREATE INDEX "PurchaseOffer_buyerId_listingId_idx" ON "PurchaseOffer"("buyerId", "listingId");
CREATE INDEX "PurchaseOffer_expiresAt_idx" ON "PurchaseOffer"("expiresAt");
CREATE INDEX "PurchaseOffer_reservedUntil_status_idx" ON "PurchaseOffer"("reservedUntil", "status");

ALTER TABLE "PurchaseOffer" ADD CONSTRAINT "PurchaseOffer_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseOffer" ADD CONSTRAINT "PurchaseOffer_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CartItem" ADD COLUMN "purchaseOfferId" TEXT,
ADD COLUMN "lockedUnitPrice" DECIMAL(65,30),
ADD COLUMN "reservedUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "CartItem_purchaseOfferId_key" ON "CartItem"("purchaseOfferId");
CREATE INDEX "CartItem_reservedUntil_idx" ON "CartItem"("reservedUntil");

ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_purchaseOfferId_fkey" FOREIGN KEY ("purchaseOfferId") REFERENCES "PurchaseOffer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'po_' || substr(md5(random()::text || 'PURCHASE_OFFER_VALIDITY_HOURS'), 1, 24),
  'PURCHASE_OFFER_VALIDITY_HOURS',
  '48',
  'مهلت اعتبار پیشنهاد خرید برای تأیید فروشنده (ساعت)',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SystemSetting" WHERE "key" = 'PURCHASE_OFFER_VALIDITY_HOURS'
);

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'po_' || substr(md5(random()::text || 'PURCHASE_OFFER_CART_RESERVE_HOURS'), 1, 24),
  'PURCHASE_OFFER_CART_RESERVE_HOURS',
  '24',
  'مهلت رزرو سبد پس از تأیید پیشنهاد خرید (ساعت)',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SystemSetting" WHERE "key" = 'PURCHASE_OFFER_CART_RESERVE_HOURS'
);
