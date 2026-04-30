-- Add optional outline and note fields for blog posts
ALTER TABLE "BlogPost"
ADD COLUMN "outline" TEXT,
ADD COLUMN "note" TEXT;
