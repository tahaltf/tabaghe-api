-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill from latest message or ticket creation
UPDATE "Ticket" t
SET "lastMessageAt" = COALESCE(
  (SELECT MAX(m."createdAt") FROM "TicketMessage" m WHERE m."ticketId" = t.id),
  t."createdAt"
);

-- CreateTable
CREATE TABLE "UserRatingHistory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "previous" DOUBLE PRECISION NOT NULL,
    "next" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderId" TEXT,
    "listingId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserRatingHistory_userId_createdAt_idx" ON "UserRatingHistory"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "UserRatingHistory" ADD CONSTRAINT "UserRatingHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
