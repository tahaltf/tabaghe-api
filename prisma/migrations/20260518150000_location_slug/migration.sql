-- اسلاگ یکتا برای استان/شهر (صفحات SEO دسته + مکان)
ALTER TABLE "Location" ADD COLUMN "slug" TEXT;

-- مقدار موقت تا backfill از seed یا اسکریپت
UPDATE "Location" SET "slug" = CONCAT('legacy-', "id") WHERE "slug" IS NULL;

ALTER TABLE "Location" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");
