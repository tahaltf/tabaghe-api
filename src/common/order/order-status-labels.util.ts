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

export const ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA = 'تایید با اصلاح مالی';

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

/** برچسب وضعیت با در نظر گرفتن meta (مثلاً اصلاح مالی معاوضه روی VERIFIED_AT_HUB) */
export function resolveOrderStatusLabelFromMeta(
  meta: Record<string, unknown>,
): string {
  const explicit =
    typeof meta.statusLabel === 'string' && meta.statusLabel.trim()
      ? meta.statusLabel.trim()
      : '';
  if (explicit) return explicit;

  const status = typeof meta.status === 'string' ? meta.status : '';
  const settlementKind = String(meta.settlementKind ?? '');
  const phase = String(meta.phase ?? '');
  const resolution = String(meta.resolution ?? '');

  if (status && normalizeStatusKey(status) === OrderStatus.VERIFIED_AT_HUB) {
    if (
      settlementKind === 'exchange-financial-settlement' ||
      phase.includes('financial_settlement') ||
      phase.includes('exchange_financial') ||
      resolution === 'FINANCIAL_SETTLEMENT_THEN_SHIP' ||
      meta.exchangeFinancialSettlement === true
    ) {
      return ORDER_STATUS_FINANCIAL_SETTLEMENT_LABEL_FA;
    }
  }

  return getOrderStatusLabelFa(status);
}
