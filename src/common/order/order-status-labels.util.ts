import { OrderStatus } from '@prisma/client';

/** برچسب فارسی وضعیت سفارش — برای اعلان، SMS و UI */
export const ORDER_STATUS_LABELS_FA: Partial<Record<OrderStatus, string>> = {
  PENDING: 'در انتظار',
  AWAITING_PAYMENT: 'در انتظار پرداخت',
  PAID: 'پرداخت شد',
  AWAITING_SHIPMENT_TO_HUB: 'در انتظار ارسال به هاب',
  SHIPPED_TO_HUB: 'ارسال شده به هاب',
  RECEIVED_AT_HUB: 'تحویل هاب شد',
  CHECKING_AT_HUB: 'در حال بررسی در هاب',
  VERIFIED_AT_HUB: 'تایید در هاب',
  REJECTED_AT_HUB: 'رد شده در هاب',
  SHIPPED_TO_BUYER: 'ارسال به خریدار',
  SHIPPED: 'ارسال شد',
  DELIVERED: 'تحویل داده شد',
  RETURN_REQUESTED: 'در انتظار ثبت مرجوعی خریدار',
  RETURN_SHIPPED: 'مرجوعی توسط خریدار ارسال شد',
  COMPLETED: 'تکمیل شد',
  DISPUTED: 'اختلاف',
  CANCELLED: 'لغو شد',
};

const STATUS_ALIASES: Record<string, OrderStatus> = {
  CHECKING_IN_HUB: OrderStatus.CHECKING_AT_HUB,
  CHECKING: OrderStatus.CHECKING_AT_HUB,
};

function normalizeStatusKey(status: string): string {
  return status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
}

export function getOrderStatusLabelFa(
  status: string | null | undefined,
): string {
  if (!status?.trim()) return '';
  const raw = status.trim();
  if (/[\u0600-\u06FF]/.test(raw)) return raw;

  const normalized = normalizeStatusKey(raw);
  const mapped = STATUS_ALIASES[normalized] ?? (normalized as OrderStatus);
  return ORDER_STATUS_LABELS_FA[mapped] ?? raw;
}
