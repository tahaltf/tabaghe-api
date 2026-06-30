-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "singleItemSale" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
