-- اگر مقدار WAITLISTED قبلاً به enum اضافه نشده باشد، اضافه می‌کند (ایدمپوتنت).
-- برای دیتابیس‌هایی که migrate کامل اجرا نشده یا فقط db push شده‌اند.
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
