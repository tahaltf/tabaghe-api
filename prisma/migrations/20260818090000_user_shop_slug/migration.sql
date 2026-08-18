-- AlterTable
ALTER TABLE "User" ADD COLUMN "shopSlug" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_shopSlug_key" ON "User"("shopSlug");
