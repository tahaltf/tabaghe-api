/*
  Warnings:

  - The values [ENDED] on the enum `AuctionStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "AuctionStatus_new" AS ENUM ('ACTIVE', 'FINISHED');
ALTER TABLE "public"."ListingAuction" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "ListingAuction" ALTER COLUMN "status" TYPE "AuctionStatus_new" USING ("status"::text::"AuctionStatus_new");
ALTER TYPE "AuctionStatus" RENAME TO "AuctionStatus_old";
ALTER TYPE "AuctionStatus_new" RENAME TO "AuctionStatus";
DROP TYPE "public"."AuctionStatus_old";
ALTER TABLE "ListingAuction" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "ListingAuction" ADD COLUMN     "finishedAt" TIMESTAMP(3);
