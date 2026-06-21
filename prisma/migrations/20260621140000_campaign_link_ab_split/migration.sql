-- A/B split for campaign links sharing a splitGroup
ALTER TABLE "CampaignLink" ADD COLUMN "splitGroup" TEXT;
ALTER TABLE "CampaignLink" ADD COLUMN "splitWeight" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "CampaignLink_splitGroup_isActive_idx" ON "CampaignLink"("splitGroup", "isActive");
