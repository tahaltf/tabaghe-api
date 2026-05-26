import {
  Order,
  OrderStatus,
  OrderType,
  Prisma,
} from '@prisma/client';
import { isExchangePaymentTimeoutCancelReason } from './exchange-offer-display.util';
import { reconcileExchangeOfferStatusWithOrder } from './exchange-order-sync.util';

type BlockingListingOrder = {
  id: string;
  status: OrderStatus;
  exchangeOfferId: string | null;
  totalAmount: unknown;
  type: OrderType;
};

const RESUMABLE_EXCHANGE_CHECKOUT_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_PAYMENT,
  OrderStatus.PENDING,
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
];

function isPaymentTimeoutCancelledOrder(order: {
  status: OrderStatus;
  cancelReason?: string | null;
  exchangeHubInspection?: unknown;
}): boolean {
  if (order.status !== OrderStatus.CANCELLED) return false;
  const hub = (order.exchangeHubInspection ?? {}) as Record<string, unknown>;
  return (
    Boolean(hub['paymentTimeout']) ||
    isExchangePaymentTimeoutCancelReason(order.cancelReason)
  );
}

function isResumableExchangeCheckout(
  order: BlockingListingOrder,
  activeExchangeOfferId: string,
): boolean {
  return (
    order.type === OrderType.EXCHANGE &&
    order.exchangeOfferId === activeExchangeOfferId &&
    RESUMABLE_EXCHANGE_CHECKOUT_STATUSES.includes(order.status)
  );
}

/**
 * @deprecated از prepareListingSlotForExchangeCheckout استفاده کنید
 */
export async function shouldRemoveStaleExchangeListingOrder(
  tx: Prisma.TransactionClient,
  blocking: BlockingListingOrder,
  activeExchangeOfferId: string,
): Promise<boolean> {
  if (isResumableExchangeCheckout(blocking, activeExchangeOfferId)) {
    return false;
  }
  if (blocking.type !== OrderType.EXCHANGE) {
    return true;
  }
  if (blocking.status === OrderStatus.CANCELLED) {
    return true;
  }
  if (blocking.exchangeOfferId !== activeExchangeOfferId) {
    return true;
  }
  return true;
}

export async function removeStaleListingOrderForAcceptedExchange(
  tx: Prisma.TransactionClient,
  listingId: string,
  acceptedOfferId: string,
): Promise<void> {
  await prepareListingSlotForExchangeCheckout(
    tx,
    listingId,
    acceptedOfferId,
  );
}

/**
 * قبل از پرداخت معاوضه ACCEPTED: هر سفارش غیرقابل‌ادامه روی آگهی حذف می‌شود
 * (شامل سفارش DIRECT قدیمی، معاوضه لغوشده، پیشنهاد دیگر، REJECTED_AT_HUB و …).
 * فقط سفارش همان پیشنهاد در وضعیت AWAITING_PAYMENT / PENDING / AWAITING_SHIPMENT_TO_HUB می‌ماند.
 */
export async function prepareListingSlotForExchangeCheckout(
  tx: Prisma.TransactionClient,
  listingId: string,
  activeExchangeOfferId: string,
): Promise<Order | null> {
  await reconcileExchangeOfferStatusWithOrder(tx, activeExchangeOfferId);

  const slot = await tx.order.findUnique({
    where: { listingId },
  });

  if (
    slot &&
    !isResumableExchangeCheckout(slot, activeExchangeOfferId) &&
    !isPaymentTimeoutCancelledOrder(slot)
  ) {
    await tx.order.delete({ where: { id: slot.id } });
  }

  let order = await tx.order.findFirst({
    where: { exchangeOfferId: activeExchangeOfferId },
  });

  if (order && !isResumableExchangeCheckout(order, activeExchangeOfferId)) {
    if (!isPaymentTimeoutCancelledOrder(order)) {
      await tx.order.delete({ where: { id: order.id } });
      order = null;
    }
  }

  if (!order) {
    const slotAfter = await tx.order.findUnique({ where: { listingId } });
    if (
      slotAfter &&
      isResumableExchangeCheckout(slotAfter, activeExchangeOfferId)
    ) {
      order = slotAfter;
    }
  }

  return order;
}

/** @deprecated نام قبلی — همان prepareListingSlotForExchangeCheckout */
export async function resolveExchangeCheckoutOrder(
  tx: Prisma.TransactionClient,
  listingId: string,
  activeExchangeOfferId: string,
): Promise<Order | null> {
  return prepareListingSlotForExchangeCheckout(
    tx,
    listingId,
    activeExchangeOfferId,
  );
}
