import { ExchangeOfferStatus, OrderStatus } from '@prisma/client';
import { resolveExchangeOfferListDisplay } from './exchange-offer-display.util';
import {
  isExchangeOrderActivelyProgressing,
  isExchangeOrderTerminalForUserActions,
  reconcileExchangeOfferStatusWithOrder,
} from './exchange-order-sync.util';

describe('isExchangeOrderActivelyProgressing', () => {
  it('includes shipment and hub phases', () => {
    expect(
      isExchangeOrderActivelyProgressing(OrderStatus.AWAITING_SHIPMENT_TO_HUB),
    ).toBe(true);
    expect(isExchangeOrderActivelyProgressing(OrderStatus.CANCELLED)).toBe(
      false,
    );
  });
});

describe('isExchangeOrderTerminalForUserActions', () => {
  it('treats payment-timeout cancel as terminal', () => {
    expect(
      isExchangeOrderTerminalForUserActions({
        status: OrderStatus.CANCELLED,
        cancelReason: 'اتمام مهلت پرداخت',
      }),
    ).toBe(true);
  });

  it('does not treat active shipment as terminal', () => {
    expect(
      isExchangeOrderTerminalForUserActions({
        status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
      }),
    ).toBe(false);
  });
});

describe('resolveExchangeOfferListDisplay active order override', () => {
  it('shows ACCEPTED when offer row is stale CANCELLED but order progressed', () => {
    const result = resolveExchangeOfferListDisplay(
      ExchangeOfferStatus.CANCELLED,
      { status: OrderStatus.AWAITING_SHIPMENT_TO_HUB },
    );
    expect(result.status).toBe(ExchangeOfferStatus.ACCEPTED);
    expect(result.exchangeCancelKind).toBeNull();
  });
});

describe('reconcileExchangeOfferStatusWithOrder', () => {
  it('restores ACCEPTED when order is in fulfillment', async () => {
    const updates: unknown[] = [];
    const tx = {
      exchangeOffer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: ExchangeOfferStatus.CANCELLED }),
        update: jest.fn().mockImplementation((args) => {
          updates.push(args);
          return Promise.resolve(args);
        }),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          status: OrderStatus.AWAITING_SHIPMENT_TO_HUB,
        }),
      },
    };

    const changed = await reconcileExchangeOfferStatusWithOrder(
      tx as never,
      'offer-1',
    );
    expect(changed).toBe(true);
    expect(updates).toHaveLength(1);
    expect((updates[0] as { data: { status: string } }).data.status).toBe(
      ExchangeOfferStatus.ACCEPTED,
    );
  });

  it('no-op when order is terminal cancelled', async () => {
    const tx = {
      exchangeOffer: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ status: ExchangeOfferStatus.CANCELLED }),
        update: jest.fn(),
      },
      order: {
        findFirst: jest.fn().mockResolvedValue({
          status: OrderStatus.CANCELLED,
        }),
      },
    };

    const changed = await reconcileExchangeOfferStatusWithOrder(
      tx as never,
      'offer-1',
    );
    expect(changed).toBe(false);
    expect(tx.exchangeOffer.update).not.toHaveBeenCalled();
  });
});
