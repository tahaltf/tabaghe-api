/** نمایش فارسی مدت باقی‌مانده تا یک مهلت */
export function formatRemainingDurationFa(distanceMs: number): string {
  if (!Number.isFinite(distanceMs) || distanceMs <= 0) {
    return '';
  }

  const totalSeconds = Math.floor(distanceMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    if (hours > 0) return `${days} روز و ${hours} ساعت`;
    return `${days} روز`;
  }

  if (hours > 0) {
    if (minutes > 0) return `${hours} ساعت و ${minutes} دقیقه`;
    return `${hours} ساعت`;
  }

  if (minutes > 0) return `${minutes} دقیقه`;
  return 'کمتر از ۱ دقیقه';
}

export function formatLessThanRemainingFa(distanceMs: number): string {
  const formatted = formatRemainingDurationFa(distanceMs);
  return formatted ? `کمتر از ${formatted}` : 'مهلت به پایان رسیده';
}
