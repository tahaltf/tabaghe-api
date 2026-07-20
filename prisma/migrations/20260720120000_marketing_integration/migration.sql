-- CreateEnum
CREATE TYPE "MarketingPlatform" AS ENUM ('INSTAGRAM');

-- CreateEnum
CREATE TYPE "MarketingAccountStatus" AS ENUM ('ACTIVE', 'TOKEN_EXPIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "MarketingPostStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "MarketingMediaType" AS ENUM ('IMAGE', 'VIDEO', 'CAROUSEL', 'REEL', 'STORY');

-- CreateEnum
CREATE TYPE "MarketingMessageDirection" AS ENUM ('IN', 'OUT');

-- CreateTable
CREATE TABLE "MarketingAccount" (
    "id" TEXT NOT NULL,
    "platform" "MarketingPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "profilePicture" TEXT,
    "status" "MarketingAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastError" TEXT,
    "connectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingAccountToken" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "lastRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingAccountToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMediaAsset" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "localPath" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "mediaType" "MarketingMediaType" NOT NULL DEFAULT 'IMAGE',
    "caption" TEXT,
    "altText" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "fileSize" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPost" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "mediaAssetId" TEXT,
    "mediaAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "platformMediaId" TEXT,
    "containerId" TEXT,
    "mediaType" "MarketingMediaType" NOT NULL,
    "caption" TEXT,
    "status" "MarketingPostStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingConversation" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "externalThreadId" TEXT NOT NULL,
    "participantName" TEXT,
    "participantAvatar" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "externalMessageId" TEXT,
    "direction" "MarketingMessageDirection" NOT NULL,
    "text" TEXT,
    "attachments" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentByAdminId" TEXT,

    CONSTRAINT "MarketingMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingInsightSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metricKey" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "period" TEXT NOT NULL DEFAULT 'day',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingInsightSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingAccount_platform_status_idx" ON "MarketingAccount"("platform", "status");

-- CreateIndex
CREATE INDEX "MarketingAccount_connectedById_idx" ON "MarketingAccount"("connectedById");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAccount_platform_externalId_key" ON "MarketingAccount"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingAccountToken_accountId_key" ON "MarketingAccountToken"("accountId");

-- CreateIndex
CREATE INDEX "MarketingMediaAsset_accountId_createdAt_idx" ON "MarketingMediaAsset"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketingMediaAsset_createdById_idx" ON "MarketingMediaAsset"("createdById");

-- CreateIndex
CREATE INDEX "MarketingPost_accountId_status_idx" ON "MarketingPost"("accountId", "status");

-- CreateIndex
CREATE INDEX "MarketingPost_status_scheduledAt_idx" ON "MarketingPost"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MarketingPost_createdById_idx" ON "MarketingPost"("createdById");

-- CreateIndex
CREATE INDEX "MarketingConversation_accountId_lastMessageAt_idx" ON "MarketingConversation"("accountId", "lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingConversation_accountId_externalThreadId_key" ON "MarketingConversation"("accountId", "externalThreadId");

-- CreateIndex
CREATE INDEX "MarketingMessage_conversationId_sentAt_idx" ON "MarketingMessage"("conversationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingMessage_conversationId_externalMessageId_key" ON "MarketingMessage"("conversationId", "externalMessageId");

-- CreateIndex
CREATE INDEX "MarketingInsightSnapshot_accountId_metricKey_capturedAt_idx" ON "MarketingInsightSnapshot"("accountId", "metricKey", "capturedAt");

-- CreateIndex
CREATE INDEX "MarketingInsightSnapshot_accountId_capturedAt_idx" ON "MarketingInsightSnapshot"("accountId", "capturedAt");

-- AddForeignKey
ALTER TABLE "MarketingAccount" ADD CONSTRAINT "MarketingAccount_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingAccountToken" ADD CONSTRAINT "MarketingAccountToken_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMediaAsset" ADD CONSTRAINT "MarketingMediaAsset_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketingAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMediaAsset" ADD CONSTRAINT "MarketingMediaAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MarketingMediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPost" ADD CONSTRAINT "MarketingPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingConversation" ADD CONSTRAINT "MarketingConversation_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "MarketingConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingMessage" ADD CONSTRAINT "MarketingMessage_sentByAdminId_fkey" FOREIGN KEY ("sentByAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingInsightSnapshot" ADD CONSTRAINT "MarketingInsightSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MarketingAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
