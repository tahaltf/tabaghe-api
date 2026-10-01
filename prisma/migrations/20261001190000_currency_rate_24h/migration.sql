-- AlterTable: 24h FX change baseline
ALTER TABLE "CurrencyRate" ADD COLUMN IF NOT EXISTS "rate24hAgo" DECIMAL(65,30);
ALTER TABLE "CurrencyRate" ADD COLUMN IF NOT EXISTS "rate24hAgoAt" TIMESTAMP(3);
