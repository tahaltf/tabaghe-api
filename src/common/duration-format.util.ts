/** نمایش فارسی مدت بر حسب دقیقه (برای مهلت‌های تنظیمات ادمین) */
export function formatMinutesDurationFa(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return 'مهلت نامعتبر';
  }
  const totalSeconds = Math.floor(minutes * 60);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const mins = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    if (hours > 0) return `${days} روز و ${hours} ساعت`;
    return `${days} روز`;
  }
  if (hours > 0) {
    if (mins > 0) return `${hours} ساعت و ${mins} دقیقه`;
    return `${hours} ساعت`;
  }
  if (mins > 0) return `${mins} دقیقه`;
  return 'کمتر از ۱ دقیقه';
}
