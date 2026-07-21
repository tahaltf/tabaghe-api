-- AlterEnum
ALTER TYPE "WalletTransactionType" ADD VALUE 'AI_TOKEN_PURCHASE';

-- CreateEnum
CREATE TYPE "AiTokenLedgerAction" AS ENUM ('GRANT_KYC_WELCOME', 'GRANT_PLAN', 'PURCHASE', 'RESERVE', 'COMMIT', 'RELEASE', 'EXPIRE_PLAN', 'ADMIN_ADJUST');
CREATE TYPE "AiTokenBucket" AS ENUM ('PLAN', 'PURCHASED');
CREATE TYPE "AiContentType" AS ENUM ('STORY', 'POST', 'CAPTION');
CREATE TYPE "AiContentRequestStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "Plan" ADD COLUMN "aiTokensPerMonth" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiTokenBalance" (
    "userId" TEXT NOT NULL,
    "planTokens" INTEGER NOT NULL DEFAULT 0,
    "purchasedTokens" INTEGER NOT NULL DEFAULT 0,
    "reservedTokens" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiTokenBalance_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "AiTokenLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "AiTokenLedgerAction" NOT NULL,
    "bucket" "AiTokenBucket",
    "amount" INTEGER NOT NULL,
    "balanceAfter" INTEGER,
    "planPurchaseId" TEXT,
    "walletTxId" TEXT,
    "requestId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiTokenLedger_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiContentRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "type" "AiContentType" NOT NULL,
    "userPrompt" TEXT,
    "status" "AiContentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultImagePath" TEXT,
    "resultCaption" TEXT,
    "tokensCharged" INTEGER NOT NULL DEFAULT 0,
    "provider" TEXT,
    "model" TEXT,
    "costUsd" DECIMAL(10,6),
    "errorMessage" TEXT,
    "parentRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiContentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiTokenLedger_userId_createdAt_idx" ON "AiTokenLedger"("userId", "createdAt");
CREATE INDEX "AiTokenLedger_requestId_idx" ON "AiTokenLedger"("requestId");
CREATE INDEX "AiContentRequest_userId_createdAt_idx" ON "AiContentRequest"("userId", "createdAt");
CREATE INDEX "AiContentRequest_listingId_idx" ON "AiContentRequest"("listingId");

-- AddForeignKey
ALTER TABLE "AiTokenBalance" ADD CONSTRAINT "AiTokenBalance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTokenLedger" ADD CONSTRAINT "AiTokenLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiTokenLedger" ADD CONSTRAINT "AiTokenLedger_planPurchaseId_fkey" FOREIGN KEY ("planPurchaseId") REFERENCES "UserPlanPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiTokenLedger" ADD CONSTRAINT "AiTokenLedger_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AiContentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AiContentRequest" ADD CONSTRAINT "AiContentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContentRequest" ADD CONSTRAINT "AiContentRequest_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiContentRequest" ADD CONSTRAINT "AiContentRequest_parentRequestId_fkey" FOREIGN KEY ("parentRequestId") REFERENCES "AiContentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
