const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** تبدیل ارقام فارسی/عربی به لاتین */
export function toLatinDigits(text: string): string {
  return String(text ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const pi = PERSIAN_DIGITS.indexOf(ch);
    if (pi >= 0) return String(pi);
    const ai = ARABIC_DIGITS.indexOf(ch);
    return ai >= 0 ? String(ai) : ch;
  });
}

/** تبدیل ارقام لاتین به فارسی */
export function toPersianDigits(text: string): string {
  return String(text ?? '').replace(/[0-9]/g, (d) => PERSIAN_DIGITS[+d] ?? d);
}

/**
 * واریانت‌های یکتا برای سرچ: متن خام + لاتین + فارسی.
 * تا `۶۰` و `60` هر دو عنوان را پیدا کنند.
 */
export function searchDigitVariants(query: string): string[] {
  const trimmed = String(query ?? '').trim();
  if (!trimmed) return [];
  const latin = toLatinDigits(trimmed);
  const persian = toPersianDigits(latin);
  return [...new Set([trimmed, latin, persian].filter((v) => v.length > 0))];
}
