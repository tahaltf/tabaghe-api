import { ListingStatus, OrderStatus, OrderType } from '@prisma/client';

export const UNPAID_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
];

export const LISTING_SOLD_UNPAID_CANCEL_REASON =
  'کالا فروش رفته؛ سفارش لغو شد';

export const USER_UNPAID_CANCEL_REASON =
  'لغو توسط خریدار پیش از پرداخت';

export const ADMIN_UNPAID_CANCEL_REASON =
  'لغو سفارش بدون پرداخت توسط پشتیبانی';

export type DirectCancelKind = 'LISTING_SOLD' | 'USER_UNPAID' | 'ADMIN_UNPAID' | null;

export function isUnpaidOrderStatus(status: OrderStatus): boolean {
  return UNPAID_ORDER_STATUSES.includes(status);
}

export function isListingSoldUnpaidCancelReason(
  reason: string | null | undefined,
): boolean {
  const text = String(reason ?? '').trim();
  return text.includes('کالا فروش رفته');
}

export function resolveDirectCancelKind(params: {
  status: OrderStatus;
  type: OrderType;
  cancelReason?: string | null;
}): DirectCancelKind {
  if (params.status !== OrderStatus.CANCELLED) return null;
  if (params.type === OrderType.EXCHANGE) return null;
  const reason = String(params.cancelReason ?? '').trim();
  if (isListingSoldUnpaidCancelReason(reason)) return 'LISTING_SOLD';
  if (reason.includes('لغو توسط خریدار پیش از پرداخت')) return 'USER_UNPAID';
  if (reason.includes('بدون پرداخت')) return 'ADMIN_UNPAID';
  return null;
}

/** وضعیت‌هایی که نشان می‌دهند موجودی آگهی توسط خریدار دیگری رزرو/مصرف شده */
export const LISTING_CAPACITY_BLOCKING_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PAID,
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.SHIPPED_TO_HUB,
  OrderStatus.RECEIVED_AT_HUB,
  OrderStatus.CHECKING_AT_HUB,
  OrderStatus.VERIFIED_AT_HUB,
  OrderStatus.REJECTED_AT_HUB,
  OrderStatus.SHIPPED_TO_BUYER,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
  OrderStatus.RETURN_REQUESTED,
  OrderStatus.RETURN_SHIPPED,
  OrderStatus.DISPUTED,
  OrderStatus.COMPLETED,
];

export function listingUnavailableForUnpaidOrder(listing: {
  status: ListingStatus;
  stockQuantity?: number | null;
}): boolean {
  if (listing.status === ListingStatus.SOLD) return true;
  return (listing.stockQuantity ?? 1) <= 0;
}
