/*
  Warnings:

  - You are about to drop the column `shippingPayer` on the `ListingDirect` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "shippingPayer" "ShippingPayer" NOT NULL DEFAULT 'BUYER_PREPAID';

-- AlterTable
ALTER TABLE "ListingDirect" DROP COLUMN "shippingPayer",
ADD COLUMN     "allowExchange" BOOLEAN NOT NULL DEFAULT false;
