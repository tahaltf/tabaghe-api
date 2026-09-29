-- CreateEnum
CREATE TYPE "ProductRequestStatus" AS ENUM ('PENDING');

-- CreateEnum
CREATE TYPE "ProductRequestCondition" AS ENUM ('NEW', 'USED', 'ANY');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'ADMIN_ALERT_NEW_PRODUCT_REQUEST';

-- CreateTable
CREATE TABLE "ProductRequest" (
    "id" TEXT NOT NULL,
    "trackingCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "condition" "ProductRequestCondition",
    "budgetMin" DECIMAL(65,30),
    "budgetMax" DECIMAL(65,30),
    "quantity" INTEGER DEFAULT 1,
    "description" TEXT NOT NULL,
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProductRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductRequest_trackingCode_key" ON "ProductRequest"("trackingCode");

-- CreateIndex
CREATE INDEX "ProductRequest_userId_idx" ON "ProductRequest"("userId");

-- CreateIndex
CREATE INDEX "ProductRequest_status_idx" ON "ProductRequest"("status");

-- CreateIndex
CREATE INDEX "ProductRequest_categoryId_idx" ON "ProductRequest"("categoryId");

-- CreateIndex
CREATE INDEX "ProductRequest_createdAt_idx" ON "ProductRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;
