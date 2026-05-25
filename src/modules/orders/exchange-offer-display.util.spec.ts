import { ExchangeOfferStatus, OrderStatus } from '@prisma/client';
import {
  isExchangeSingleSideNoShipmentOrder,
  resolveExchangeOfferListDisplay,
  resolveExchangeOrderListDisplay,
} from './exchange-offer-display.util';

describe('resolveExchangeOfferListDisplay', () => {
  it('maps REJECTED_AT_HUB + singleSideNoShipment to cancelled no-shipment', () => {
    const result = resolveExchangeOfferListDisplay(ExchangeOfferStatus.ACCEPTED, {
      status: OrderStatus.REJECTED_AT_HUB,
      exchangeHubInspection: { singleSideNoShipmentTimeout: true },
    });
    expect(result.status).toBe(ExchangeOfferStatus.CANCELLED);
    expect(result.exchangeCancelKind).toBe('NO_SHIPMENT_TIMEOUT');
  });

  it('maps REJECTED_AT_HUB without singleSide flag to hub reject', () => {
    const result = resolveExchangeOfferListDisplay(ExchangeOfferStatus.ACCEPTED, {
      status: OrderStatus.REJECTED_AT_HUB,
      exchangeHubInspection: { resolution: 'FAIL' },
    });
    expect(result.exchangeCancelKind).toBe('HUB_REJECT');
  });
});

describe('resolveExchangeOrderListDisplay', () => {
  it('maps single-side no-shipment REJECTED_AT_HUB to NO_SHIPMENT_TIMEOUT', () => {
    const result = resolveExchangeOrderListDisplay({
      status: OrderStatus.REJECTED_AT_HUB,
      exchangeHubInspection: { singleSideNoShipmentTimeout: true },
    });
    expect(result.exchangeCancelKind).toBe('NO_SHIPMENT_TIMEOUT');
  });
});

describe('isExchangeSingleSideNoShipmentOrder', () => {
  it('detects single-side timeout flag', () => {
    expect(
      isExchangeSingleSideNoShipmentOrder({
        status: OrderStatus.REJECTED_AT_HUB,
        exchangeHubInspection: { singleSideNoShipmentTimeout: true },
      }),
    ).toBe(true);
  });
});
