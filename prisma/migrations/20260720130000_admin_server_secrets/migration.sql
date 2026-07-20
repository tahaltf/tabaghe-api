-- CreateTable
CREATE TABLE "SystemSecret" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "encryptedValue" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemSecret_key_key" ON "SystemSecret"("key");

-- CreateIndex
CREATE INDEX "SystemSecret_updatedAt_idx" ON "SystemSecret"("updatedAt");
