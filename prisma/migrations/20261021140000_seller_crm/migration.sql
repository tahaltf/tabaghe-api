-- CreateEnum
CREATE TYPE "SellerLeadStage" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'ONBOARDING', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "SellerLeadSource" AS ENUM ('INSTAGRAM', 'BAZAAR_VISIT', 'REFERRAL', 'WEBSITE', 'DIVAR', 'TELEGRAM', 'OTHER');

-- CreateEnum
CREATE TYPE "SellerLeadLostReason" AS ENUM ('NO_RESPONSE', 'NO_INTEREST', 'COMPETITOR', 'NOT_FIT', 'OTHER');

-- CreateEnum
CREATE TYPE "SellerLeadActivityType" AS ENUM ('NOTE', 'CALL', 'SMS', 'STAGE_CHANGE', 'FOLLOW_UP_SET', 'SYSTEM');

-- CreateTable
CREATE TABLE "SellerLead" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "shopName" TEXT,
    "phone" TEXT NOT NULL,
    "city" TEXT,
    "province" TEXT,
    "categoryHint" TEXT,
    "source" "SellerLeadSource" NOT NULL DEFAULT 'OTHER',
    "stage" "SellerLeadStage" NOT NULL DEFAULT 'NEW',
    "lostReason" "SellerLeadLostReason",
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "convertedUserId" TEXT,
    "createdByAdminId" TEXT NOT NULL,
    "convertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerLeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "SellerLeadActivityType" NOT NULL,
    "body" TEXT,
    "meta" JSONB,
    "createdByAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerLeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SellerLead_stage_idx" ON "SellerLead"("stage");

-- CreateIndex
CREATE INDEX "SellerLead_nextFollowUpAt_idx" ON "SellerLead"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "SellerLead_phone_idx" ON "SellerLead"("phone");

-- CreateIndex
CREATE INDEX "SellerLead_source_idx" ON "SellerLead"("source");

-- CreateIndex
CREATE INDEX "SellerLead_stage_nextFollowUpAt_idx" ON "SellerLead"("stage", "nextFollowUpAt");

-- CreateIndex
CREATE INDEX "SellerLead_convertedUserId_idx" ON "SellerLead"("convertedUserId");

-- CreateIndex
CREATE INDEX "SellerLead_createdByAdminId_idx" ON "SellerLead"("createdByAdminId");

-- CreateIndex
CREATE INDEX "SellerLeadActivity_leadId_createdAt_idx" ON "SellerLeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "SellerLeadActivity_createdByAdminId_idx" ON "SellerLeadActivity"("createdByAdminId");

-- AddForeignKey
ALTER TABLE "SellerLead" ADD CONSTRAINT "SellerLead_convertedUserId_fkey" FOREIGN KEY ("convertedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLead" ADD CONSTRAINT "SellerLead_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLeadActivity" ADD CONSTRAINT "SellerLeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "SellerLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerLeadActivity" ADD CONSTRAINT "SellerLeadActivity_createdByAdminId_fkey" FOREIGN KEY ("createdByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
