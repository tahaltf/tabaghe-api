import { RepairRequestStatus } from '@prisma/client';

/** برچسب فارسی وضعیت درخواست تعمیر — برای اعلان و SMS */
export const REPAIR_STATUS_LABELS_FA: Partial<
  Record<RepairRequestStatus, string>
> = {
  PENDING_REVIEW: 'در انتظار بررسی',
  REJECTED: 'رد شده',
  APPROVED: 'تایید شده',
  DELIVERY_TIME_SELECTED: 'زمان انتخاب شد',
  AWAITING_DELIVERY: 'در راه هاب',
  RECEIVED_AT_HUB: 'رسید به هاب',
  UNDER_INSPECTION: 'در حال کارشناسی',
  RESULT_READY: 'نتیجه آماده',
  IN_PROGRESS: 'در حال تعمیر',
  READY_TO_SHIP: 'آماده ارسال',
  SHIPPED_BACK: 'ارسال شد به کاربر',
  COMPLETED: 'تکمیل شده',
  CANCELLED: 'لغو شده',
};

function normalizeStatusKey(status: string): string {
  return status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function getRepairStatusLabelFa(
  status: string | null | undefined,
): string {
  if (!status?.trim()) return '';
  const raw = status.trim();
  if (/[\u0600-\u06FF]/.test(raw)) return raw;

  const normalized = normalizeStatusKey(raw);
  return REPAIR_STATUS_LABELS_FA[normalized as RepairRequestStatus] ?? raw;
}
