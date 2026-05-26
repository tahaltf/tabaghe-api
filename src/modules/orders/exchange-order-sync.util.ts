import {
  ExchangeOfferStatus,
  OrderStatus,
  Prisma,
} from '@prisma/client';
type LinkedExchangeOrder = {
  status: OrderStatus;
  exchangeHubInspection?: unknown;
};

export function isExchangeSingleSideNoShipmentOrder(
  linked: LinkedExchangeOrder | null | undefined,
): boolean {
  if (!linked || linked.status !== OrderStatus.REJECTED_AT_HUB) {
    return false;
  }
  const ex = (linked.exchangeHubInspection ?? {}) as Record<string, unknown>;
  return Boolean(ex['singleSideNoShipmentTimeout']);
}

export function isExchangePaymentTimeoutCancelReason(
  reason: string | null | undefined,
): boolean {
  const text = String(reason ?? '').trim();
  return text.includes('مهلت پرداخت') || text.includes('اتمام مهلت پرداخت');
}

/** سفارش معاوضه از مرحله پرداخت/ارسال عبور کرده — پیشنهاد نباید «لغو» نمایش داده شود */
export const EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.SHIPPED_TO_HUB,
  OrderStatus.RECEIVED_AT_HUB,
  OrderStatus.CHECKING_AT_HUB,
  OrderStatus.VERIFIED_AT_HUB,
  OrderStatus.SHIPPED_TO_BUYER,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export const EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES: readonly OrderStatus[] = [
  OrderStatus.PENDING,
  OrderStatus.AWAITING_PAYMENT,
];

export function isExchangeOrderActivelyProgressing(
  status: OrderStatus,
): boolean {
  return EXCHANGE_ACTIVE_FULFILLMENT_ORDER_STATUSES.includes(status);
}

export function isExchangeOrderPaymentPending(status: OrderStatus): boolean {
  return EXCHANGE_PAYMENT_PENDING_ORDER_STATUSES.includes(status);
}

export function isExchangeOrderTerminalForUserActions(order: {
  status: OrderStatus;
  exchangeHubInspection?: unknown;
  cancelReason?: string | null;
}): boolean {
  if (
    order.status === OrderStatus.CANCELLED ||
    order.status === OrderStatus.COMPLETED
  ) {
    return true;
  }
  if (isExchangeSingleSideNoShipmentOrder(order)) {
    return true;
  }
  const ex = (order.exchangeHubInspection ?? {}) as Record<string, unknown>;
  if (
    order.status === OrderStatus.REJECTED_AT_HUB &&
    ex['resolution'] === 'RETURN_BOTH_TO_SENDERS' &&
    Boolean(ex['refundsReleasedAt'])
  ) {
    return true;
  }
  return false;
}

export function exchangeTerminalUserMessage(order: {
  status: OrderStatus;
  cancelReason?: string | null;
  exchangeHubInspection?: unknown;
}): string {
  if (order.status === OrderStatus.COMPLETED) {
    return 'این معامله به‌طور کامل انجام شده است.';
  }
  if (isExchangeSingleSideNoShipmentOrder(order)) {
    return 'معامله به‌دلیل عدم ارسال یکی از طرفین در مهلت مقرر لغو شده است.';
  }
  if (isExchangePaymentTimeoutCancelReason(order.cancelReason)) {
    return 'مهلت پرداخت این معاوضه به پایان رسیده و امکان ادامه وجود ندارد.';
  }
  if (order.status === OrderStatus.CANCELLED) {
    return 'این معامله لغو شده است و امکان ادامه وجود ندارد.';
  }
  const ex = (order.exchangeHubInspection ?? {}) as Record<string, unknown>;
  if (
    order.status === OrderStatus.REJECTED_AT_HUB &&
    ex['resolution'] === 'RETURN_BOTH_TO_SENDERS'
  ) {
    return 'کارشناسی این معامله به مرجوع ختم شده است.';
  }
  return 'این معامله در وضعیت نهایی است و امکان ادامه وجود ندارد.';
}

/**
 * اگر سفارش هنوز جاری است ولی پیشنهاد اشتباهاً CANCELLED شده (باگ کرون قدیمی)، پیشنهاد را بازمی‌گرداند.
 */
export async function reconcileExchangeOfferStatusWithOrder(
  tx: Prisma.TransactionClient,
  exchangeOfferId: string,
): Promise<boolean> {
  const offer = await tx.exchangeOffer.findUnique({
    where: { id: exchangeOfferId },
    select: { status: true },
  });
  if (!offer || offer.status !== ExchangeOfferStatus.CANCELLED) {
    return false;
  }

  const order = await tx.order.findFirst({
    where: { exchangeOfferId },
    select: { status: true },
  });
  if (!order) return false;

  const shouldBeAccepted =
    isExchangeOrderActivelyProgressing(order.status) ||
    isExchangeOrderPaymentPending(order.status);

  if (!shouldBeAccepted) return false;

  await tx.exchangeOffer.update({
    where: { id: exchangeOfferId },
    data: { status: ExchangeOfferStatus.ACCEPTED },
  });
  return true;
}
