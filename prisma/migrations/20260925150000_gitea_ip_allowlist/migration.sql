-- CreateTable
CREATE TABLE "GiteaIpAllowlistEntry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ipCidr" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GiteaIpAllowlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GiteaIpAllowlistEntry_ipCidr_key" ON "GiteaIpAllowlistEntry"("ipCidr");

-- CreateIndex
CREATE INDEX "GiteaIpAllowlistEntry_enabled_idx" ON "GiteaIpAllowlistEntry"("enabled");
