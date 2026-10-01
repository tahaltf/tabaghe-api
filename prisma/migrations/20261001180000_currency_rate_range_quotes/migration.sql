-- AlterTable: multi-source FX range fields
ALTER TABLE "CurrencyRate" ADD COLUMN IF NOT EXISTS "rateMin" DECIMAL(65,30);
ALTER TABLE "CurrencyRate" ADD COLUMN IF NOT EXISTS "rateMax" DECIMAL(65,30);
ALTER TABLE "CurrencyRate" ADD COLUMN IF NOT EXISTS "quotes" JSONB;
