import {
  buildPartyOrderNotifyMeta,
  resolveNotificationRuleKeyCandidates,
} from './notification-meta-enrichment.util';

describe('buildPartyOrderNotifyMeta', () => {
  it('sets per-role note from buyerNote/sellerNote', () => {
    expect(
      buildPartyOrderNotifyMeta('BUYER', {
        buyerNote: 'برای شما',
        sellerNote: 'برای فروشنده',
      }),
    ).toMatchObject({
      role: 'BUYER',
      note: 'برای شما',
      buyerNote: 'برای شما',
      sellerNote: 'برای فروشنده',
    });
    expect(
      buildPartyOrderNotifyMeta('SELLER', {
        buyerNote: 'برای شما',
        sellerNote: 'برای فروشنده',
      }),
    ).toMatchObject({
      role: 'SELLER',
      note: 'برای فروشنده',
    });
  });
});

describe('resolveNotificationRuleKeyCandidates', () => {
  it('prefers role+phaseKey before role-only and base type', () => {
    expect(
      resolveNotificationRuleKeyCandidates('ORDER_STATUS_CHANGED', 'SELLER', {
        phaseKey: 'exchange_hub_outbound_TO_SELLER',
      }),
    ).toEqual([
      'ORDER_STATUS_CHANGED@SELLER@exchange_hub_outbound_TO_SELLER',
      'ORDER_STATUS_CHANGED@exchange_hub_outbound_TO_SELLER',
      'ORDER_STATUS_CHANGED@SELLER',
      'ORDER_STATUS_CHANGED',
    ]);
  });

  it('builds phaseKey from phase and leg when phaseKey is absent', () => {
    expect(
      resolveNotificationRuleKeyCandidates('ORDER_STATUS_CHANGED', 'BUYER', {
        phase: 'exchange_hub_outbound_shipped',
        leg: 'TO_BUYER',
      }),
    ).toEqual([
      'ORDER_STATUS_CHANGED@BUYER@exchange_hub_outbound_shipped_TO_BUYER',
      'ORDER_STATUS_CHANGED@exchange_hub_outbound_shipped_TO_BUYER',
      'ORDER_STATUS_CHANGED@BUYER',
      'ORDER_STATUS_CHANGED',
    ]);
  });

  it('falls back to shared deadline template without role suffix', () => {
    expect(
      resolveNotificationRuleKeyCandidates('ACTION_DEADLINE_REMINDER', 'BUYER', {
        phaseKey: 'exchange_payment_BUYER',
      }),
    ).toEqual([
      'ACTION_DEADLINE_REMINDER@BUYER@exchange_payment_BUYER',
      'ACTION_DEADLINE_REMINDER@exchange_payment_BUYER',
      'ACTION_DEADLINE_REMINDER@exchange_payment',
      'ACTION_DEADLINE_REMINDER@BUYER',
      'ACTION_DEADLINE_REMINDER',
    ]);
  });
});
