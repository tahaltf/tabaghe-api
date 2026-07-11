-- CreateEnum
CREATE TYPE "SurveyRole" AS ENUM ('BUYER', 'SELLER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'POST_PURCHASE_SURVEY';

-- CreateTable
CREATE TABLE "PostPurchaseSurvey" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "SurveyRole" NOT NULL,
    "token" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "scheduledSendAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostPurchaseSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostPurchaseSurvey_token_key" ON "PostPurchaseSurvey"("token");

-- CreateIndex
CREATE INDEX "PostPurchaseSurvey_scheduledSendAt_sentAt_idx" ON "PostPurchaseSurvey"("scheduledSendAt", "sentAt");

-- CreateIndex
CREATE INDEX "PostPurchaseSurvey_userId_idx" ON "PostPurchaseSurvey"("userId");

-- CreateIndex
CREATE INDEX "PostPurchaseSurvey_respondedAt_idx" ON "PostPurchaseSurvey"("respondedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PostPurchaseSurvey_orderId_role_key" ON "PostPurchaseSurvey"("orderId", "role");

-- AddForeignKey
ALTER TABLE "PostPurchaseSurvey" ADD CONSTRAINT "PostPurchaseSurvey_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostPurchaseSurvey" ADD CONSTRAINT "PostPurchaseSurvey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
