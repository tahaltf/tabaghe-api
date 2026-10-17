-- CreateTable
CREATE TABLE "CrawlerIpAllowlistEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipCidr" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlerIpAllowlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrawlerIpAllowlistEntry_ipCidr_key" ON "CrawlerIpAllowlistEntry"("ipCidr");

-- CreateIndex
CREATE INDEX "CrawlerIpAllowlistEntry_enabled_idx" ON "CrawlerIpAllowlistEntry"("enabled");
