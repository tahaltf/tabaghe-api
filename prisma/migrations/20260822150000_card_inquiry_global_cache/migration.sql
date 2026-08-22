-- CreateTable
CREATE TABLE "CardToIbanCache" (
    "cardNumber" TEXT NOT NULL,
    "shabaNumber" TEXT,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "responseRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardToIbanCache_pkey" PRIMARY KEY ("cardNumber")
);

-- CreateTable
CREATE TABLE "CardOwnerMatchCache" (
    "cacheKey" TEXT NOT NULL,
    "cardNumber" TEXT NOT NULL,
    "nationalCode" TEXT NOT NULL,
    "birthDate" TEXT NOT NULL,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "responseRaw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardOwnerMatchCache_pkey" PRIMARY KEY ("cacheKey")
);

-- CreateIndex
CREATE INDEX "CardOwnerMatchCache_cardNumber_idx" ON "CardOwnerMatchCache"("cardNumber");
