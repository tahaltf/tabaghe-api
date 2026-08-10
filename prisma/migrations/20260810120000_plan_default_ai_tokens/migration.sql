-- مقدار پیش‌فرض توکن برای پلن‌های استاندارد که هنوز ۰ مانده‌اند
UPDATE "Plan"
SET "aiTokensPerMonth" = 10,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE title = 'بالکن' AND "aiTokensPerMonth" = 0;

UPDATE "Plan"
SET "aiTokensPerMonth" = 30,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE title = 'پنت‌هاوس' AND "aiTokensPerMonth" = 0;

-- شارژ توکن پلن برای کاربرانی که الان پلن ACTIVE با توکن دارند ولی موجودی planTokensشان ۰ است
INSERT INTO "AiTokenBalance" ("userId", "planTokens", "purchasedTokens", "reservedTokens", "updatedAt")
SELECT DISTINCT ON (upp."userId")
  upp."userId",
  p."aiTokensPerMonth",
  0,
  0,
  CURRENT_TIMESTAMP
FROM "UserPlanPurchase" upp
INNER JOIN "Plan" p ON p.id = upp."planId"
WHERE upp.status = 'ACTIVE'
  AND (upp."expiresAt" IS NULL OR upp."expiresAt" > CURRENT_TIMESTAMP)
  AND p."aiTokensPerMonth" > 0
ORDER BY upp."userId", upp."createdAt" DESC
ON CONFLICT ("userId") DO UPDATE
SET
  "planTokens" = CASE
    WHEN "AiTokenBalance"."planTokens" = 0 THEN EXCLUDED."planTokens"
    ELSE "AiTokenBalance"."planTokens"
  END,
  "updatedAt" = CURRENT_TIMESTAMP;
