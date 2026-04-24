-- Add GODADMIN role to UserRole enum
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'GODADMIN';

-- Add account activation flag for users
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
