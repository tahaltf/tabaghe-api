-- Per-user referral commission override (null = global default)
ALTER TABLE "User" ADD COLUMN "referralCommissionPercent" DOUBLE PRECISION;
