-- AlterEnum
ALTER TYPE "ListingStatus" ADD VALUE 'SOLD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatar" TEXT,
ADD COLUMN     "bio" TEXT,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyPush" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySms" BOOLEAN NOT NULL DEFAULT false;
