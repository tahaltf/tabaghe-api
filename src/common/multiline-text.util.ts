/** یکسان‌سازی انواع خط جدید هنگام ذخیرهٔ متن چندخطی */
export function normalizeMultilineText(
  text: string | null | undefined,
): string {
  return String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u2028/g, '\n')
    .replace(/\u2029/g, '\n\n');
}
