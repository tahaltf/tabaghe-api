-- CreateEnum
CREATE TYPE "UserLoginMethod" AS ENUM ('OTP', 'ADMIN_OTP');

-- CreateEnum
CREATE TYPE "PaymentInitKind" AS ENUM ('ORDER', 'WALLET_TOPUP', 'REPAIR', 'CHECKOUT_SESSION', 'CHECKOUT_WALLET');

-- CreateTable
CREATE TABLE "UserLoginLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" "UserLoginMethod" NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentInitLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PaymentInitKind" NOT NULL,
    "paymentSource" TEXT NOT NULL DEFAULT 'GATEWAY',
    "amount" DECIMAL(65,30),
    "referenceId" TEXT,
    "authority" TEXT,
    "gateway" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentInitLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserLoginLog_userId_createdAt_idx" ON "UserLoginLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserLoginLog_ipAddress_createdAt_idx" ON "UserLoginLog"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentInitLog_userId_createdAt_idx" ON "PaymentInitLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentInitLog_authority_idx" ON "PaymentInitLog"("authority");

-- CreateIndex
CREATE INDEX "PaymentInitLog_referenceId_kind_idx" ON "PaymentInitLog"("referenceId", "kind");

-- CreateIndex
CREATE INDEX "PaymentInitLog_ipAddress_createdAt_idx" ON "PaymentInitLog"("ipAddress", "createdAt");

-- AddForeignKey
ALTER TABLE "UserLoginLog" ADD CONSTRAINT "UserLoginLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentInitLog" ADD CONSTRAINT "PaymentInitLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
