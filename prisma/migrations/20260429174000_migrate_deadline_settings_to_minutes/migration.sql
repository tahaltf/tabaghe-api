-- Migrate legacy day-based deadline settings to minute-based keys.
-- This migration is idempotent and keeps existing minute-based values untouched.

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'migr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  'SELLER_SHIP_DEADLINE_MINUTES',
  GREATEST(1, FLOOR(CAST("value" AS numeric) * 1440))::text,
  'مهلت ارسال فروشنده پس از پرداخت (دقیقه)',
  NOW()
FROM "SystemSetting"
WHERE "key" = 'SELLER_SHIP_DEADLINE_DAYS'
  AND NOT EXISTS (
    SELECT 1
    FROM "SystemSetting" ss
    WHERE ss."key" = 'SELLER_SHIP_DEADLINE_MINUTES'
  )
  AND "value" ~ '^[0-9]+(\.[0-9]+)?$';

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'migr_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
  'BUYER_CONFIRM_DEADLINE_MINUTES',
  GREATEST(1, FLOOR(CAST("value" AS numeric) * 1440))::text,
  'مهلت تایید/شکایت خریدار پس از ارسال (دقیقه)',
  NOW()
FROM "SystemSetting"
WHERE "key" = 'BUYER_CONFIRM_DEADLINE_DAYS'
  AND NOT EXISTS (
    SELECT 1
    FROM "SystemSetting" ss
    WHERE ss."key" = 'BUYER_CONFIRM_DEADLINE_MINUTES'
  )
  AND "value" ~ '^[0-9]+(\.[0-9]+)?$';

-- Optional cleanup of legacy keys (safe after deployment verifies minute-based keys are active).
DELETE FROM "SystemSetting"
WHERE "key" IN ('SELLER_SHIP_DEADLINE_DAYS', 'BUYER_CONFIRM_DEADLINE_DAYS');
