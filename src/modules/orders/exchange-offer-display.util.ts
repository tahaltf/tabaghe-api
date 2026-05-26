import { ExchangeOfferStatus, OrderStatus } from '@prisma/client';
import {
  isExchangeOrderActivelyProgressing,
  isExchangeOrderPaymentPending,
  isExchangePaymentTimeoutCancelReason,
  isExchangeSingleSideNoShipmentOrder,
} from './exchange-order-sync.util';

export type ExchangeCancelKind =
  | 'PAYMENT_TIMEOUT'
  | 'NO_SHIPMENT_TIMEOUT'
  | 'BOTH_NO_SHIPMENT'
  | 'HUB_REJECT'
  | null;

export {
  isExchangePaymentTimeoutCancelReason,
  isExchangeSingleSideNoShipmentOrder,
} from './exchange-order-sync.util';

function paymentTimeoutFromInspection(
  ex: Record<string, unknown>,
  cancelReason?: string | null,
): boolean {
  return Boolean(ex['paymentTimeout']) || isExchangePaymentTimeoutCancelReason(cancelReason);
}

function resolveCancelledExchangeCancelKind(
  ex: Record<string, unknown>,
  cancelReason?: string | null,
): ExchangeCancelKind {
  if (paymentTimeoutFromInspection(ex, cancelReason)) return 'PAYMENT_TIMEOUT';
  if (ex['singleSideNoShipmentTimeout']) return 'NO_SHIPMENT_TIMEOUT';
  return 'BOTH_NO_SHIPMENT';
}

type LinkedExchangeOrder = {
  status: OrderStatus;
  exchangeHubInspection?: unknown;
  cancelReason?: string | null;
} | null | undefined;

export function resolveExchangeOfferListDisplay(
  offerStatus: ExchangeOfferStatus,
  linked: LinkedExchangeOrder,
): { status: ExchangeOfferStatus; exchangeCancelKind: ExchangeCancelKind } {
  if (!linked) {
    return { status: offerStatus, exchangeCancelKind: null };
  }

  // منبع حقیقت: وضعیت سفارش (نه فقط ردیف پیشنهاد که ممکن است اشتباه CANCELLED مانده باشد)
  if (
    isExchangeOrderActivelyProgressing(linked.status) ||
    isExchangeOrderPaymentPending(linked.status)
  ) {
    return { status: ExchangeOfferStatus.ACCEPTED, exchangeCancelKind: null };
  }

  if (linked.status === OrderStatus.CANCELLED) {
    const ex = (linked.exchangeHubInspection ?? {}) as Record<string, unknown>;
    return {
      status: ExchangeOfferStatus.CANCELLED,
      exchangeCancelKind: resolveCancelledExchangeCancelKind(
        ex,
        linked.cancelReason,
      ),
    };
  }

  if (isExchangeSingleSideNoShipmentOrder(linked as LinkedExchangeOrder)) {
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
  cancelReason?: string | null;
}): { exchangeCancelKind: ExchangeCancelKind } {
  if (order.status === OrderStatus.CANCELLED) {
    const ex = (order.exchangeHubInspection ?? {}) as Record<string, unknown>;
    return {
      exchangeCancelKind: resolveCancelledExchangeCancelKind(
        ex,
        order.cancelReason,
      ),
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
