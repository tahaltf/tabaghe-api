/**
 * پرامپت‌نویسی استوری تصویر + محاسبه هزینه توکن بر اساس طول توضیح فروشنده.
 */

export const AI_USER_PROMPT_MAX_CHARS = 400;
/** تا این تعداد کاراکتر در هزینه پایه لحاظ می‌شود */
export const AI_USER_PROMPT_FREE_CHARS = 120;
/** بعد از سهم رایگان، هر این تعداد کاراکتر = ۱ توکن اضافه */
export const AI_USER_PROMPT_CHARS_PER_EXTRA_TOKEN = 140;

export function normalizeUserPrompt(raw: string | null | undefined): string {
  return String(raw ?? '')
    .replace(/\u200c/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function assertUserPromptLength(raw: string | null | undefined): string {
  const text = normalizeUserPrompt(raw);
  if (text.length > AI_USER_PROMPT_MAX_CHARS) {
    throw new Error(
      `توضیح شما حداکثر ${AI_USER_PROMPT_MAX_CHARS} کاراکتر می‌تواند باشد.`,
    );
  }
  return text;
}

/**
 * هزینه نهایی استوری = هزینه پایه + توکن اضافه برای توضیح بلند.
 * مثال: base=2 ، ۴۰۰ کاراکتر → 2 + ceil((400-120)/140) = 2+2 = 4
 */
export function computeStoryTokenCost(
  baseCost: number,
  userPrompt?: string | null,
): number {
  const base = Math.max(1, Math.floor(baseCost) || 1);
  const len = normalizeUserPrompt(userPrompt).length;
  if (len <= AI_USER_PROMPT_FREE_CHARS) return base;
  const extraChars = len - AI_USER_PROMPT_FREE_CHARS;
  const extraTokens = Math.ceil(
    extraChars / AI_USER_PROMPT_CHARS_PER_EXTRA_TOKEN,
  );
  return base + extraTokens;
}

export function userPromptPricingHints() {
  return {
    userPromptMaxChars: AI_USER_PROMPT_MAX_CHARS,
    userPromptFreeChars: AI_USER_PROMPT_FREE_CHARS,
    userPromptCharsPerExtraToken: AI_USER_PROMPT_CHARS_PER_EXTRA_TOKEN,
  };
}
