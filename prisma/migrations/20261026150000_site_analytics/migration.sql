-- CreateEnum
CREATE TYPE "GscPropertyStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'ERROR');

-- CreateTable
CREATE TABLE "SiteSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "landingPath" TEXT,
    "referrer" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "device" TEXT,

    CONSTRAINT "SiteSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SitePageView" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "path" TEXT NOT NULL,
    "title" TEXT,
    "referrer" TEXT,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SitePageView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDailySite" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "users" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDailySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDailyPage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "path" TEXT NOT NULL,
    "pageviews" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDailyPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscProperty" (
    "id" TEXT NOT NULL,
    "siteUrl" TEXT NOT NULL,
    "status" "GscPropertyStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "lastSyncAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscProperty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailySite" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDailySite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailyPage" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "page" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDailyPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailyQuery" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDailyQuery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GscDailyPageQuery" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "page" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GscDailyPageQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteSession_userId_lastSeenAt_idx" ON "SiteSession"("userId", "lastSeenAt");
CREATE INDEX "SiteSession_firstSeenAt_idx" ON "SiteSession"("firstSeenAt");
CREATE INDEX "SiteSession_lastSeenAt_idx" ON "SiteSession"("lastSeenAt");

CREATE INDEX "SitePageView_path_viewedAt_idx" ON "SitePageView"("path", "viewedAt");
CREATE INDEX "SitePageView_viewedAt_idx" ON "SitePageView"("viewedAt");
CREATE INDEX "SitePageView_sessionId_path_viewedAt_idx" ON "SitePageView"("sessionId", "path", "viewedAt");
CREATE INDEX "SitePageView_userId_viewedAt_idx" ON "SitePageView"("userId", "viewedAt");

CREATE UNIQUE INDEX "SiteDailySite_date_key" ON "SiteDailySite"("date");
CREATE INDEX "SiteDailySite_date_idx" ON "SiteDailySite"("date");

CREATE UNIQUE INDEX "SiteDailyPage_date_path_key" ON "SiteDailyPage"("date", "path");
CREATE INDEX "SiteDailyPage_date_idx" ON "SiteDailyPage"("date");
CREATE INDEX "SiteDailyPage_path_date_idx" ON "SiteDailyPage"("path", "date");
CREATE INDEX "SiteDailyPage_pageviews_idx" ON "SiteDailyPage"("pageviews");

CREATE UNIQUE INDEX "GscProperty_siteUrl_key" ON "GscProperty"("siteUrl");

CREATE UNIQUE INDEX "GscDailySite_date_key" ON "GscDailySite"("date");
CREATE INDEX "GscDailySite_date_idx" ON "GscDailySite"("date");

CREATE UNIQUE INDEX "GscDailyPage_date_page_key" ON "GscDailyPage"("date", "page");
CREATE INDEX "GscDailyPage_date_idx" ON "GscDailyPage"("date");
CREATE INDEX "GscDailyPage_page_date_idx" ON "GscDailyPage"("page", "date");
CREATE INDEX "GscDailyPage_clicks_idx" ON "GscDailyPage"("clicks");

CREATE UNIQUE INDEX "GscDailyQuery_date_query_key" ON "GscDailyQuery"("date", "query");
CREATE INDEX "GscDailyQuery_date_idx" ON "GscDailyQuery"("date");
CREATE INDEX "GscDailyQuery_query_date_idx" ON "GscDailyQuery"("query", "date");
CREATE INDEX "GscDailyQuery_clicks_idx" ON "GscDailyQuery"("clicks");

CREATE UNIQUE INDEX "GscDailyPageQuery_date_page_query_key" ON "GscDailyPageQuery"("date", "page", "query");
CREATE INDEX "GscDailyPageQuery_date_idx" ON "GscDailyPageQuery"("date");
CREATE INDEX "GscDailyPageQuery_page_date_idx" ON "GscDailyPageQuery"("page", "date");
CREATE INDEX "GscDailyPageQuery_query_date_idx" ON "GscDailyPageQuery"("query", "date");

-- AddForeignKey
ALTER TABLE "SitePageView" ADD CONSTRAINT "SitePageView_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "SiteSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
