import { buildExchangeSettlementWalletMeta } from './exchange-settlement-wallet-meta.util';

describe('buildExchangeSettlementWalletMeta', () => {
  const order = {
    id: 'order-abc123def456',
    listing: { id: 'lst-1', title: 'آیفون ۱۳' },
  };

  it('includes order, item and reason for listing-side debit', () => {
    const meta = buildExchangeSettlementWalletMeta({
      order,
      itemSide: 'listing',
      offerTitle: 'مک‌بوک',
      amount: 500_000,
      phase: 'seller_settlement_debit_available',
    });
    expect(meta.orderShortId).toBe('DEF456');
    expect(meta.settlementItemLabel).toBe('کالای آگهی');
    expect(meta.itemTitle).toBe('آیفون ۱۳');
    expect(String(meta.description)).toContain('سفارش #DEF456');
    expect(String(meta.description)).toContain('آیفون ۱۳');
    expect(String(meta.description)).toContain('کسر از موجودی');
  });

  it('uses offer title for offer-side transactions', () => {
    const meta = buildExchangeSettlementWalletMeta({
      order,
      itemSide: 'offer',
      offerTitle: 'مک‌بوک پرو',
      amount: 200_000,
      phase: 'buyer_settlement_debit_available',
    });
    expect(meta.itemTitle).toBe('مک‌بوک پرو');
    expect(meta.settlementItemLabel).toBe('کالای پیشنهاد');
  });
});
