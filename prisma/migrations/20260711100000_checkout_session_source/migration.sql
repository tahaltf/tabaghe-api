-- CreateEnum
CREATE TYPE "CheckoutSessionSource" AS ENUM ('CART', 'DIRECT');

-- AlterTable
ALTER TABLE "CheckoutSession" ADD COLUMN "source" "CheckoutSessionSource" NOT NULL DEFAULT 'CART';
