CREATE TABLE "BlogPost" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "image" TEXT,
  "isPublished" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BlogPost_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlogPost_slug_key" ON "BlogPost"("slug");
CREATE INDEX "BlogPost_isPublished_createdAt_idx" ON "BlogPost"("isPublished", "createdAt");

-- Migrate legacy JSON posts from SystemSetting.BLOG_POSTS_JSON
INSERT INTO "BlogPost" ("id", "slug", "title", "description", "image", "isPublished", "createdAt", "updatedAt")
SELECT
  COALESCE(NULLIF(item->>'id', ''), CONCAT('legacy_blog_', md5(random()::text || clock_timestamp()::text))),
  COALESCE(NULLIF(item->>'slug', ''), CONCAT('legacy-blog-', substr(md5(random()::text || clock_timestamp()::text), 1, 8))),
  COALESCE(NULLIF(item->>'title', ''), 'بدون عنوان'),
  COALESCE(NULLIF(item->>'description', ''), NULLIF(item->>'excerpt', ''), NULLIF(item->>'content', ''), ''),
  NULLIF(item->>'image', ''),
  true,
  COALESCE(NULLIF(item->>'createdAt', '')::timestamp, CURRENT_TIMESTAMP),
  COALESCE(NULLIF(item->>'updatedAt', '')::timestamp, COALESCE(NULLIF(item->>'createdAt', '')::timestamp, CURRENT_TIMESTAMP))
FROM "SystemSetting" s
CROSS JOIN LATERAL jsonb_array_elements(
  CASE
    WHEN s."value" IS NULL OR btrim(s."value") = '' THEN '[]'::jsonb
    ELSE s."value"::jsonb
  END
) AS item
WHERE s."key" = 'BLOG_POSTS_JSON'
  AND jsonb_typeof(
    CASE
      WHEN s."value" IS NULL OR btrim(s."value") = '' THEN '[]'::jsonb
      ELSE s."value"::jsonb
    END
  ) = 'array'
  AND COALESCE(NULLIF(item->>'title', ''), '') <> ''
  AND COALESCE(NULLIF(item->>'description', ''), NULLIF(item->>'excerpt', ''), NULLIF(item->>'content', ''), '') <> ''
ON CONFLICT ("slug") DO NOTHING;

DELETE FROM "SystemSetting" WHERE "key" = 'BLOG_POSTS_JSON';
