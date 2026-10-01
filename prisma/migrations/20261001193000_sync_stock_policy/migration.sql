-- AlterTable
ALTER TABLE "WordPressConnection" ADD COLUMN "syncIntervalHours" INTEGER NOT NULL DEFAULT 12;
ALTER TABLE "WordPressConnection" ADD COLUMN "minStockForAvailable" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "ExternalProductFeed" ADD COLUMN "syncIntervalMinutes" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "ExternalProductFeed" ADD COLUMN "minStockForAvailable" INTEGER NOT NULL DEFAULT 1;
