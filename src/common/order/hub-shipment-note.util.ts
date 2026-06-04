import { OrderStatus } from '@prisma/client';

/** وضعیت‌هایی که نوتیف «ارسال از هاب» معتبر است — نه کارشناسی یا تسویه */
const HUB_OUTBOUND_NOTIFICATION_STATUSES = new Set<string>([
  OrderStatus.SHIPPED_TO_BUYER,
  OrderStatus.SHIPPED,
]);

const INSPECTION_NOTE_MARKERS = [
  'نتیجه کارشناسی معاوضه — مرجوع هر دو',
  'نتیجه کارشناسی هر کالا',
  'کارشناسی معاوضه با اصلاح مالی',
  'کارشناسی معاوضه انجام شد',
  'کالای آگهی:',
  'کالای پیشنهاد:',
  'جمع‌بندی پرونده',
  'توافق مالی',
  'اصلاح مالی نهایی',
];

export function isInspectionLikeHubNote(note: string): boolean {
  const text = note.trim();
  if (!text) return false;
  return INSPECTION_NOTE_MARKERS.some((m) => text.includes(m));
}

/** آیا meta نوتیف مربوط به ثبت رهگیری خروجی از هاب است (نه کارشناسی) */
export function isHubOutboundShipmentNotificationMeta(
  meta: Record<string, unknown>,
): boolean {
  const status = String(meta['status'] ?? '').trim();
  if (!HUB_OUTBOUND_NOTIFICATION_STATUSES.has(status)) return false;

  const note = meta['note'];
  if (typeof note !== 'string' || !note.trim()) return false;
  if (isInspectionLikeHubNote(note)) return false;

  return true;
}
