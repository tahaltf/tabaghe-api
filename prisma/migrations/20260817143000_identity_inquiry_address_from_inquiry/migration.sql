-- AlterTable
ALTER TABLE "User" ADD COLUMN "fatherName" TEXT;
ALTER TABLE "User" ADD COLUMN "identityInquiry" JSONB;

-- AlterTable
ALTER TABLE "Address" ADD COLUMN "fromInquiry" BOOLEAN NOT NULL DEFAULT false;
