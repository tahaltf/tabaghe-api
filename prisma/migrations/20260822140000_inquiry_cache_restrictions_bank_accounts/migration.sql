-- ZohalInquiryLog (if not exists from prior deploy)
CREATE TABLE IF NOT EXISTS "ZohalInquiryLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "responseRaw" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ZohalInquiryLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ZohalInquiryLog_userId_service_payloadHash_idx"
  ON "ZohalInquiryLog"("userId", "service", "payloadHash");
CREATE INDEX IF NOT EXISTS "ZohalInquiryLog_createdAt_idx"
  ON "ZohalInquiryLog"("createdAt");
CREATE INDEX IF NOT EXISTS "ZohalInquiryLog_userId_createdAt_idx"
  ON "ZohalInquiryLog"("userId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ZohalInquiryLog"
    ADD CONSTRAINT "ZohalInquiryLog_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Global postal code cache
CREATE TABLE IF NOT EXISTS "PostalCodeCache" (
    "postalCode" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT,
    "fullAddress" TEXT NOT NULL,
    "responseRaw" JSONB,
    "success" BOOLEAN NOT NULL,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostalCodeCache_pkey" PRIMARY KEY ("postalCode")
);

-- Per-user inquiry restrictions
CREATE TABLE IF NOT EXISTS "UserInquiryRestriction" (
    "userId" TEXT NOT NULL,
    "identityPayloadAttempts" INTEGER NOT NULL DEFAULT 0,
    "identityFailureCount" INTEGER NOT NULL DEFAULT 0,
    "financialPayloadAttempts" INTEGER NOT NULL DEFAULT 0,
    "financialFailureCount" INTEGER NOT NULL DEFAULT 0,
    "inquiryBlocked" BOOLEAN NOT NULL DEFAULT false,
    "manualEntryOnly" BOOLEAN NOT NULL DEFAULT false,
    "maxInquiriesPerMinute" INTEGER,
    "maxInquiriesPerDay" INTEGER,
    "blockedReason" TEXT,
    "blockedAt" TIMESTAMP(3),
    "unblockedByAdminId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserInquiryRestriction_pkey" PRIMARY KEY ("userId")
);

DO $$ BEGIN
  ALTER TABLE "UserInquiryRestriction"
    ADD CONSTRAINT "UserInquiryRestriction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Multiple bank accounts per user
CREATE TABLE IF NOT EXISTS "UserBankAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT,
    "bankCardNumber" TEXT,
    "bankCardBin" TEXT,
    "bankName" TEXT,
    "shabaNumber" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserBankAccount_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserBankAccount_userId_idx" ON "UserBankAccount"("userId");
CREATE INDEX IF NOT EXISTS "UserBankAccount_userId_isDefault_idx" ON "UserBankAccount"("userId", "isDefault");

DO $$ BEGIN
  ALTER TABLE "UserBankAccount"
    ADD CONSTRAINT "UserBankAccount_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migrate existing single bank fields to UserBankAccount
INSERT INTO "UserBankAccount" (
    "id", "userId", "bankCardNumber", "bankCardBin", "bankName", "shabaNumber",
    "isDefault", "verifiedAt", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "bankCardNumber",
    "bankCardBin",
    "bankName",
    "shabaNumber",
    true,
    "financialVerifiedAt",
    COALESCE("financialVerifiedAt", NOW()),
    NOW()
FROM "User"
WHERE ("bankCardNumber" IS NOT NULL OR "shabaNumber" IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM "UserBankAccount" ba WHERE ba."userId" = "User"."id"
  );
