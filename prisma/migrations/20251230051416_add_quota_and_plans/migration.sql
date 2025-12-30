-- CreateEnum
CREATE TYPE "QuotaReason" AS ENUM ('FREE_DIRECT', 'PLAN');

-- CreateEnum
CREATE TYPE "QuotaAction" AS ENUM ('RESERVE', 'COMMIT', 'RELEASE');

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "price" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanRule" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "type" "ListingType" NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "PlanRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPlanPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPlanPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaLedger" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" TEXT,
    "listingType" "ListingType" NOT NULL,
    "action" "QuotaAction" NOT NULL,
    "reason" "QuotaReason" NOT NULL,
    "planPurchaseId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlanRule_planId_type_key" ON "PlanRule"("planId", "type");

-- CreateIndex
CREATE INDEX "QuotaLedger_userId_listingType_idx" ON "QuotaLedger"("userId", "listingType");

-- CreateIndex
CREATE INDEX "QuotaLedger_listingId_idx" ON "QuotaLedger"("listingId");

-- AddForeignKey
ALTER TABLE "PlanRule" ADD CONSTRAINT "PlanRule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlanPurchase" ADD CONSTRAINT "UserPlanPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPlanPurchase" ADD CONSTRAINT "UserPlanPurchase_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaLedger" ADD CONSTRAINT "QuotaLedger_planPurchaseId_fkey" FOREIGN KEY ("planPurchaseId") REFERENCES "UserPlanPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
