/*
  Warnings:

  - You are about to drop the column `city` on the `Listing` table. All the data in the column will be lost.
  - You are about to drop the column `province` on the `Listing` table. All the data in the column will be lost.
  - Added the required column `cityId` to the `Listing` table without a default value. This is not possible if the table is not empty.
  - Added the required column `provinceId` to the `Listing` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Listing_province_city_idx";

-- AlterTable
ALTER TABLE "Listing" DROP COLUMN "city",
DROP COLUMN "province",
ADD COLUMN     "cityId" TEXT NOT NULL,
ADD COLUMN     "provinceId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Listing_provinceId_cityId_idx" ON "Listing"("provinceId", "cityId");

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Listing" ADD CONSTRAINT "Listing_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
