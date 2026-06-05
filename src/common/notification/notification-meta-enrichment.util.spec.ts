import { resolveNotificationRuleKeyCandidates } from './notification-meta-enrichment.util';

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
});
