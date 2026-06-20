-- CreateTable
CREATE TABLE "CampaignLink" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "targetUrl" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClickLog" (
    "id" TEXT NOT NULL,
    "campaignLinkId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "queryParams" JSONB,
    "clickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClickLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLink_slug_key" ON "CampaignLink"("slug");

-- CreateIndex
CREATE INDEX "CampaignLink_isActive_slug_idx" ON "CampaignLink"("isActive", "slug");

-- CreateIndex
CREATE INDEX "ClickLog_campaignLinkId_clickedAt_idx" ON "ClickLog"("campaignLinkId", "clickedAt");

-- AddForeignKey
ALTER TABLE "CampaignLink" ADD CONSTRAINT "CampaignLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickLog" ADD CONSTRAINT "ClickLog_campaignLinkId_fkey" FOREIGN KEY ("campaignLinkId") REFERENCES "CampaignLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
