-- غیرفعال‌سازی موقت دسته‌ها توسط ادمین (عدم نمایش در سایت)
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Category_isActive_idx" ON "Category"("isActive");
