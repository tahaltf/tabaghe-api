import {
  isExchangeAutoConfirmDue,
  isExchangeLegConfirmDeadlineExpired,
  isFirstHubShipmentForLeg,
  mergeExchangeLegConfirmDeadline,
  resolveExchangeLegConfirmDeadline,
} from './exchange-hub-confirm-deadline.util';

describe('exchange-hub-confirm-deadline', () => {
  const past = new Date(Date.now() - 60_000).toISOString();
  const future = new Date(Date.now() + 3_600_000).toISOString();

  it('resolves per-leg deadline from inspection', () => {
    const inspection = mergeExchangeLegConfirmDeadline(null, 'BUYER', past);
    const deadline = resolveExchangeLegConfirmDeadline(inspection, 'BUYER', future);
    expect(deadline?.toISOString()).toBe(past);
  });

  it('detects expired leg only when tracking exists and not confirmed', () => {
    const inspection = mergeExchangeLegConfirmDeadline(null, 'BUYER', past);
    expect(
      isExchangeLegConfirmDeadlineExpired({
        hubTrackingCode: 'ABC123',
        alreadyConfirmed: false,
        inspection,
        leg: 'BUYER',
      }),
    ).toBe(true);
    expect(
      isExchangeLegConfirmDeadlineExpired({
        hubTrackingCode: null,
        alreadyConfirmed: false,
        inspection,
        leg: 'BUYER',
      }),
    ).toBe(false);
    expect(
      isExchangeLegConfirmDeadlineExpired({
        hubTrackingCode: 'ABC123',
        alreadyConfirmed: true,
        inspection,
        leg: 'BUYER',
      }),
    ).toBe(false);
  });

  it('auto-confirm due only for shipped legs with expired deadline', () => {
    const inspection = {
      ...mergeExchangeLegConfirmDeadline(null, 'BUYER', past),
      ...mergeExchangeLegConfirmDeadline(null, 'SELLER', future),
    };
    expect(
      isExchangeAutoConfirmDue({
        hubToBuyerTrackingCode: 'B-1',
        hubToSellerTrackingCode: null,
        buyerConfirmedDelivery: false,
        sellerConfirmedDelivery: false,
        exchangeHubInspection: inspection,
      }),
    ).toBe(true);
    expect(
      isExchangeAutoConfirmDue({
        hubToBuyerTrackingCode: 'B-1',
        hubToSellerTrackingCode: null,
        buyerConfirmedDelivery: true,
        sellerConfirmedDelivery: false,
        exchangeHubInspection: inspection,
      }),
    ).toBe(false);
  });

  it('does not apply buyer deadline to seller before seller leg ships', () => {
    const inspection = mergeExchangeLegConfirmDeadline(null, 'BUYER', past);
    expect(
      resolveExchangeLegConfirmDeadline(inspection, 'SELLER', past),
    ).toBeNull();
    expect(
      isExchangeLegConfirmDeadlineExpired({
        hubTrackingCode: 'S-1',
        alreadyConfirmed: false,
        inspection,
        leg: 'SELLER',
        fallbackDeadline: past,
      }),
    ).toBe(false);
  });

  it('detects first hub shipment per leg only', () => {
    expect(isFirstHubShipmentForLeg(null, 'ABC')).toBe(true);
    expect(isFirstHubShipmentForLeg('ABC', 'ABC')).toBe(false);
    expect(isFirstHubShipmentForLeg('ABC', 'XYZ')).toBe(false);
  });
});
