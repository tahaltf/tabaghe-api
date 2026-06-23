-- CreateEnum
CREATE TYPE "ListingImportSource" AS ENUM ('MANUAL', 'WORDPRESS');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN "importSource" "ListingImportSource" NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "Listing" ADD COLUMN "externalProductId" TEXT;
ALTER TABLE "Listing" ADD COLUMN "externalSiteUrl" TEXT;
ALTER TABLE "Listing" ADD COLUMN "shortDescription" TEXT;
ALTER TABLE "Listing" ADD COLUMN "attributes" JSONB;

-- CreateIndex
CREATE INDEX "Listing_importSource_status_idx" ON "Listing"("importSource", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Listing_authorId_externalSiteUrl_externalProductId_key" ON "Listing"("authorId", "externalSiteUrl", "externalProductId");

-- CreateTable
CREATE TABLE "WordPressApiToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'default',
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "WordPressApiToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WordPressConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "siteUrl" TEXT,
    "pluginVersion" TEXT,
    "lastPingAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WordPressConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WordPressApiToken_userId_revokedAt_idx" ON "WordPressApiToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "WordPressApiToken_tokenPrefix_idx" ON "WordPressApiToken"("tokenPrefix");

-- CreateIndex
CREATE UNIQUE INDEX "WordPressConnection_userId_key" ON "WordPressConnection"("userId");

-- AddForeignKey
ALTER TABLE "WordPressApiToken" ADD CONSTRAINT "WordPressApiToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WordPressConnection" ADD CONSTRAINT "WordPressConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
