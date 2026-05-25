import {
  ExchangeOfferStatus,
  OrderStatus,
  OrderType,
} from '@prisma/client';
import { shouldRemoveStaleExchangeListingOrder } from './exchange-listing-order.util';

describe('shouldRemoveStaleExchangeListingOrder', () => {
  const tx = {
    exchangeOffer: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes AWAITING_PAYMENT order tied to WAITLISTED offer', async () => {
    tx.exchangeOffer.findUnique.mockResolvedValue({
      status: ExchangeOfferStatus.WAITLISTED,
    });

    const result = await shouldRemoveStaleExchangeListingOrder(
      tx as never,
      {
        id: 'ord-1',
        type: OrderType.EXCHANGE,
        status: OrderStatus.AWAITING_PAYMENT,
        exchangeOfferId: 'offer-old',
        totalAmount: 250000,
      },
      'offer-new',
    );

    expect(result).toBe(true);
  });

  it('keeps order for the active ACCEPTED offer', async () => {
    const result = await shouldRemoveStaleExchangeListingOrder(
      tx as never,
      {
        id: 'ord-1',
        type: OrderType.EXCHANGE,
        status: OrderStatus.AWAITING_PAYMENT,
        exchangeOfferId: 'offer-new',
        totalAmount: 250000,
      },
      'offer-new',
    );

    expect(result).toBe(false);
    expect(tx.exchangeOffer.findUnique).not.toHaveBeenCalled();
  });
});
