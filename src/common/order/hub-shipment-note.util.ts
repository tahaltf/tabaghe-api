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

const HUB_OUTBOUND_NOTIFICATION_PHASES = new Set<string>([
  'exchange_hub_outbound_shipped',
  'exchange_hub_return_outbound',
  'shipped_from_hub_to_buyer',
]);

/** آیا meta نوتیف مربوط به ثبت رهگیری خروجی از هاب است (نه کارشناسی) */
export function isHubOutboundShipmentNotificationMeta(
  meta: Record<string, unknown>,
): boolean {
  const status = String(meta['status'] ?? '').trim();
  const phase = String(meta['phase'] ?? '').trim();
  const hasOutboundPhase = HUB_OUTBOUND_NOTIFICATION_PHASES.has(phase);
  if (!HUB_OUTBOUND_NOTIFICATION_STATUSES.has(status) && !hasOutboundPhase) {
    return false;
  }

  const note = meta['note'];
  const trackingCode = meta['trackingCode'];
  const hasNote = typeof note === 'string' && note.trim().length > 0;
  const hasTracking =
    typeof trackingCode === 'string' && trackingCode.trim().length > 0;

  if (!hasNote && !(hasOutboundPhase && hasTracking)) return false;
  if (hasNote && isInspectionLikeHubNote(note)) return false;

  return true;
}
