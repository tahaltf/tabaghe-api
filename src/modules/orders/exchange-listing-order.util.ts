import {
  ExchangeOfferStatus,
  OrderStatus,
  OrderType,
  Prisma,
} from '@prisma/client';

type BlockingListingOrder = {
  id: string;
  status: OrderStatus;
  exchangeOfferId: string | null;
  totalAmount: unknown;
  type: OrderType;
};

/**
 * سفارش قدیمی روی listingId (معمولاً از پیشنهاد WAITLISTED/لغوشده) نباید
 * پرداخت پیشنهاد ACCEPTED جدید را مسدود کند.
 */
export async function shouldRemoveStaleExchangeListingOrder(
  tx: Prisma.TransactionClient,
  blocking: BlockingListingOrder,
  activeExchangeOfferId: string,
): Promise<boolean> {
  if (blocking.type !== OrderType.EXCHANGE) {
    return (
      blocking.status === OrderStatus.CANCELLED ||
      blocking.status === OrderStatus.PENDING ||
      (blocking.status === OrderStatus.AWAITING_PAYMENT &&
        Number(blocking.totalAmount ?? 0) === 0)
    );
  }

  if (
    blocking.exchangeOfferId === activeExchangeOfferId &&
    blocking.status !== OrderStatus.CANCELLED
  ) {
    return false;
  }

  if (blocking.status === OrderStatus.CANCELLED) {
    return true;
  }

  if (
    blocking.status === OrderStatus.PENDING ||
    (blocking.status === OrderStatus.AWAITING_PAYMENT &&
      Number(blocking.totalAmount ?? 0) === 0)
  ) {
    if (!blocking.exchangeOfferId) {
      return true;
    }
    const linked = await tx.exchangeOffer.findUnique({
      where: { id: blocking.exchangeOfferId },
      select: { status: true },
    });
    return linked?.status !== ExchangeOfferStatus.ACCEPTED;
  }

  if (
    blocking.status === OrderStatus.AWAITING_PAYMENT &&
    blocking.exchangeOfferId &&
    blocking.exchangeOfferId !== activeExchangeOfferId
  ) {
    const linked = await tx.exchangeOffer.findUnique({
      where: { id: blocking.exchangeOfferId },
      select: { status: true },
    });
    return linked?.status !== ExchangeOfferStatus.ACCEPTED;
  }

  return false;
}

export async function removeStaleListingOrderForAcceptedExchange(
  tx: Prisma.TransactionClient,
  listingId: string,
  acceptedOfferId: string,
): Promise<void> {
  const order = await tx.order.findUnique({
    where: { listingId },
    select: {
      id: true,
      status: true,
      exchangeOfferId: true,
      totalAmount: true,
      type: true,
    },
  });
  if (!order || order.exchangeOfferId === acceptedOfferId) {
    return;
  }
  if (
    await shouldRemoveStaleExchangeListingOrder(tx, order, acceptedOfferId)
  ) {
    await tx.order.delete({ where: { id: order.id } });
  }
}
