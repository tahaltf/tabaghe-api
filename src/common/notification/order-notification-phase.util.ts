import { OrderStatus } from '@prisma/client';

/** فاز اعلان برای سفارش فروش مستقیم / مزایده (بدون status خام) */
const TRADE_ORDER_PHASE_BY_STATUS: Partial<Record<OrderStatus, string>> = {
  RECEIVED_AT_HUB: 'hub_received',
  CHECKING_AT_HUB: 'hub_inspection_started',
  VERIFIED_AT_HUB: 'hub_inspection_verified',
  REJECTED_AT_HUB: 'hub_inspection_rejected',
  SHIPPED_TO_BUYER: 'shipped_from_hub_to_buyer',
  SHIPPED: 'seller_shipped_to_buyer',
  DELIVERED: 'awaiting_delivery_confirm',
  RETURN_REQUESTED: 'return_shipped',
  RETURN_SHIPPED: 'return_shipped',
  DISPUTED: 'dispute_filed',
  CANCELLED: 'admin_cancel_refund',
};

/** فاز fallback برای تغییر وضعیت ادمین روی معاوضه (رویدادهای اختصاصی اولویت دارند) */
const EXCHANGE_ORDER_PHASE_BY_STATUS: Partial<Record<OrderStatus, string>> = {
  AWAITING_SHIPMENT_TO_HUB: 'exchange_ready_to_ship',
  VERIFIED_AT_HUB: 'exchange_hub_inspection_verified',
  REJECTED_AT_HUB: 'exchange_hub_inspection_rejected',
};

export function resolveTradeOrderNotificationPhase(
  status: OrderStatus,
): string | undefined {
  return TRADE_ORDER_PHASE_BY_STATUS[status];
}

export function resolveExchangeOrderNotificationPhase(
  status: OrderStatus,
): string | undefined {
  return EXCHANGE_ORDER_PHASE_BY_STATUS[status];
}

export function resolveOrderNotificationPhase(
  status: OrderStatus,
  orderType: string,
): string | undefined {
  if (orderType === 'EXCHANGE') {
    return resolveExchangeOrderNotificationPhase(status);
  }
  if (orderType === 'DIRECT' || orderType === 'AUCTION') {
    return resolveTradeOrderNotificationPhase(status);
  }
  return undefined;
}
