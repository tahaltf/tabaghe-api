-- Set default rating to 5 for new users
ALTER TABLE "User"
ALTER COLUMN "rating" SET DEFAULT 5;

-- Backfill existing users who still have the legacy initial value
UPDATE "User"
SET "rating" = 5
WHERE "rating" = 0;
