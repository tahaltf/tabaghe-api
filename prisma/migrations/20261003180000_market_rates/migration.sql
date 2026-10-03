-- تابلو بازار (طلا / سکه / تتر / نفت / ...)
CREATE TABLE IF NOT EXISTS "MarketRate" (
    "code" TEXT NOT NULL,
    "nameFa" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "value" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'toman',
    "source" TEXT NOT NULL DEFAULT 'n8n',
    "change" TEXT,
    "meta" JSONB,
    "fetchedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketRate_pkey" PRIMARY KEY ("code")
);

CREATE INDEX IF NOT EXISTS "MarketRate_category_code_idx" ON "MarketRate"("category", "code");
