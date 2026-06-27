-- Enable SMS notifications by default for all existing users
UPDATE "User" SET "notifySms" = true WHERE "notifySms" = false;

-- Change column default for new users
ALTER TABLE "User" ALTER COLUMN "notifySms" SET DEFAULT true;
