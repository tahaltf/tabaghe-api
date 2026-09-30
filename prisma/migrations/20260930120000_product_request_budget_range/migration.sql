INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'pr_' || substr(md5(random()::text || 'PRODUCT_REQUEST_BUDGET_RANGE_MIN'), 1, 24),
  'PRODUCT_REQUEST_BUDGET_RANGE_MIN',
  '0',
  'کف اسلایدر بودجه درخواست کالا (تومان)',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SystemSetting" WHERE "key" = 'PRODUCT_REQUEST_BUDGET_RANGE_MIN'
);

INSERT INTO "SystemSetting" ("id", "key", "value", "description", "updatedAt")
SELECT
  'pr_' || substr(md5(random()::text || 'PRODUCT_REQUEST_BUDGET_RANGE_MAX'), 1, 24),
  'PRODUCT_REQUEST_BUDGET_RANGE_MAX',
  '800000000',
  'سقف اسلایدر بودجه درخواست کالا (تومان)',
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "SystemSetting" WHERE "key" = 'PRODUCT_REQUEST_BUDGET_RANGE_MAX'
);
