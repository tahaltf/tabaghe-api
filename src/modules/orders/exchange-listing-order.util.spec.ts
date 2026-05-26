import {
  OrderStatus,
  OrderType,
} from '@prisma/client';
import {
  prepareListingSlotForExchangeCheckout,
  shouldRemoveStaleExchangeListingOrder,
} from './exchange-listing-order.util';

describe('exchange listing slot cleanup', () => {
  const makeTx = (slot: unknown, byOffer: unknown = null) => ({
    order: {
      findUnique: jest
        .fn()
        .mockResolvedValueOnce(slot)
        .mockResolvedValue(slot),
      findFirst: jest.fn().mockResolvedValue(byOffer),
      delete: jest.fn().mockResolvedValue({}),
    },
    exchangeOffer: {
      findUnique: jest.fn().mockResolvedValue({ status: 'ACCEPTED' }),
      update: jest.fn().mockResolvedValue({}),
    },
  });

  it('removes stale DIRECT order blocking exchange checkout', async () => {
    const slot = {
      id: 'ord-direct',
      type: OrderType.DIRECT,
      status: OrderStatus.PAID,
      exchangeOfferId: null,
      totalAmount: 1000,
    };
    const tx = makeTx(slot, null);

    const result = await prepareListingSlotForExchangeCheckout(
      tx as never,
      'lst-1',
      'offer-new',
    );

    expect(tx.order.delete).toHaveBeenCalledWith({ where: { id: 'ord-direct' } });
    expect(result).toBeNull();
  });

  it('keeps resumable EXCHANGE order for the active offer', async () => {
    const slot = {
      id: 'ord-ex',
      type: OrderType.EXCHANGE,
      status: OrderStatus.AWAITING_PAYMENT,
      exchangeOfferId: 'offer-new',
      totalAmount: 0,
    };
    const tx = makeTx(slot, slot);

    const result = await prepareListingSlotForExchangeCheckout(
      tx as never,
      'lst-1',
      'offer-new',
    );

    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(result?.id).toBe('ord-ex');
  });

  it('keeps payment-timeout CANCELLED exchange order (no silent re-checkout)', async () => {
    const cancelled = {
      id: 'ord-pay-timeout',
      type: OrderType.EXCHANGE,
      status: OrderStatus.CANCELLED,
      exchangeOfferId: 'offer-new',
      totalAmount: 250000,
      cancelReason: 'اتمام مهلت پرداخت',
      exchangeHubInspection: { paymentTimeout: true },
    };
    const tx = makeTx(null, cancelled);

    const result = await prepareListingSlotForExchangeCheckout(
      tx as never,
      'lst-1',
      'offer-new',
    );

    expect(tx.order.delete).not.toHaveBeenCalled();
    expect(result?.id).toBe('ord-pay-timeout');
  });

  it('shouldRemoveStale returns true for non-exchange blocking order', async () => {
    const result = await shouldRemoveStaleExchangeListingOrder(
      { exchangeOffer: { findUnique: jest.fn() } } as never,
      {
        id: 'x',
        type: OrderType.DIRECT,
        status: OrderStatus.PAID,
        exchangeOfferId: null,
        totalAmount: 1,
      },
      'offer-new',
    );
    expect(result).toBe(true);
  });
});
