-- اجرای دستی در صورت خطای enum WAITLISTED (مثلاً وقتی migrate deploy اجرا نشده):
-- psql "$DATABASE_URL" -f scripts/add-exchange-waitlisted-enum.sql
DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    INNER JOIN pg_type t ON e.enumtypid = t.oid
    INNER JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.typname = 'ExchangeOfferStatus'
      AND e.enumlabel = 'WAITLISTED'
  ) THEN
    ALTER TYPE "ExchangeOfferStatus" ADD VALUE 'WAITLISTED';
  END IF;
END
$migration$;
