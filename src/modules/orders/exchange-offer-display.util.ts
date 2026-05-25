import { ExchangeOfferStatus, OrderStatus } from '@prisma/client';

export type ExchangeCancelKind =
  | 'NO_SHIPMENT_TIMEOUT'
  | 'BOTH_NO_SHIPMENT'
  | 'HUB_REJECT'
  | null;

type LinkedExchangeOrder = {
  status: OrderStatus;
  exchangeHubInspection?: unknown;
} | null | undefined;

export function isExchangeSingleSideNoShipmentOrder(
  linked: LinkedExchangeOrder,
): boolean {
  if (!linked || linked.status !== OrderStatus.REJECTED_AT_HUB) {
    return false;
  }
  const ex = (linked.exchangeHubInspection ?? {}) as Record<string, unknown>;
  return Boolean(ex['singleSideNoShipmentTimeout']);
}

export function resolveExchangeOfferListDisplay(
  offerStatus: ExchangeOfferStatus,
  linked: LinkedExchangeOrder,
): { status: ExchangeOfferStatus; exchangeCancelKind: ExchangeCancelKind } {
  if (!linked) {
    return { status: offerStatus, exchangeCancelKind: null };
  }

  if (linked.status === OrderStatus.CANCELLED) {
    const ex = (linked.exchangeHubInspection ?? {}) as Record<string, unknown>;
    return {
      status: ExchangeOfferStatus.CANCELLED,
      exchangeCancelKind: ex['singleSideNoShipmentTimeout']
        ? 'NO_SHIPMENT_TIMEOUT'
        : 'BOTH_NO_SHIPMENT',
    };
  }

  if (isExchangeSingleSideNoShipmentOrder(linked)) {
    return {
      status: ExchangeOfferStatus.CANCELLED,
      exchangeCancelKind: 'NO_SHIPMENT_TIMEOUT',
    };
  }

  if (linked.status === OrderStatus.REJECTED_AT_HUB) {
    return {
      status: offerStatus,
      exchangeCancelKind: 'HUB_REJECT',
    };
  }

  return { status: offerStatus, exchangeCancelKind: null };
}

/** برچسب لیست «خریدهای من» / «فروش‌های من» برای سفارش معاوضه */
export function resolveExchangeOrderListDisplay(order: {
  status: OrderStatus;
  exchangeHubInspection?: unknown;
}): { exchangeCancelKind: ExchangeCancelKind } {
  if (order.status === OrderStatus.CANCELLED) {
    const ex = (order.exchangeHubInspection ?? {}) as Record<string, unknown>;
    return {
      exchangeCancelKind: ex['singleSideNoShipmentTimeout']
        ? 'NO_SHIPMENT_TIMEOUT'
        : 'BOTH_NO_SHIPMENT',
    };
  }
  if (isExchangeSingleSideNoShipmentOrder(order)) {
    return { exchangeCancelKind: 'NO_SHIPMENT_TIMEOUT' };
  }
  if (order.status === OrderStatus.REJECTED_AT_HUB) {
    return { exchangeCancelKind: 'HUB_REJECT' };
  }
  return { exchangeCancelKind: null };
}
