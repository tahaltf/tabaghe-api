-- سقف کارمزد فروش مستقیم همه دسته‌ها: ۱۰ میلیون تومان
UPDATE "Category" SET "feeCapDirect" = 10000000;

ALTER TABLE "Category" ALTER COLUMN "feeCapDirect" SET DEFAULT 10000000;
