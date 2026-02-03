/*
  Warnings:

  - A unique constraint covering the columns `[nationalCode]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('INCOMPLETE', 'PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstName" TEXT,
ADD COLUMN     "lastName" TEXT,
ADD COLUMN     "nationalCode" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'INCOMPLETE';

-- CreateIndex
CREATE UNIQUE INDEX "User_nationalCode_key" ON "User"("nationalCode");
