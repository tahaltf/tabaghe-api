-- CreateTable
CREATE TABLE "CrawlerPanelUser" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "ipAllowlistEntryId" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrawlerPanelUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrawlerPanelUser_username_key" ON "CrawlerPanelUser"("username");

-- CreateIndex
CREATE INDEX "CrawlerPanelUser_enabled_idx" ON "CrawlerPanelUser"("enabled");

-- CreateIndex
CREATE INDEX "CrawlerPanelUser_ipAllowlistEntryId_idx" ON "CrawlerPanelUser"("ipAllowlistEntryId");

-- AddForeignKey
ALTER TABLE "CrawlerPanelUser" ADD CONSTRAINT "CrawlerPanelUser_ipAllowlistEntryId_fkey" FOREIGN KEY ("ipAllowlistEntryId") REFERENCES "CrawlerIpAllowlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
