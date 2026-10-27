-- Remove non-human and internal traffic recorded before the tracker started filtering it.

-- Sessions already classified as bots, or with no user agent at all (pageviews cascade).
DELETE FROM "SiteSession" WHERE "device" = 'bot' OR "device" IS NULL;

-- Staff browsing the public site.
DELETE FROM "SitePageView"
WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" IN ('ADMIN', 'GODADMIN'));

DELETE FROM "SiteSession" s
WHERE (s."userId" IN (SELECT "id" FROM "User" WHERE "role" IN ('ADMIN', 'GODADMIN')))
   OR NOT EXISTS (SELECT 1 FROM "SitePageView" v WHERE v."sessionId" = s."id");

-- Guests who later logged in count as one visitor.
UPDATE "SitePageView" v
SET "userId" = s."userId"
FROM "SiteSession" s
WHERE v."sessionId" = s."id" AND v."userId" IS NULL AND s."userId" IS NOT NULL;

-- Rebuild daily rollups (Tehran calendar days, fixed UTC+03:30) from the cleaned raw data.
DELETE FROM "SiteDailyPage";
DELETE FROM "SiteDailySite";

INSERT INTO "SiteDailySite" ("id", "date", "pageviews", "sessions", "users", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  ("viewedAt" + interval '210 minutes')::date,
  COUNT(*)::int,
  COUNT(DISTINCT "sessionId")::int,
  COUNT(DISTINCT COALESCE("userId", 's:' || "sessionId"))::int,
  NOW(),
  NOW()
FROM "SitePageView"
GROUP BY 2;

INSERT INTO "SiteDailyPage" ("id", "date", "path", "pageviews", "sessions", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  ("viewedAt" + interval '210 minutes')::date,
  "path",
  COUNT(*)::int,
  COUNT(DISTINCT "sessionId")::int,
  NOW(),
  NOW()
FROM "SitePageView"
GROUP BY 2, 3;
