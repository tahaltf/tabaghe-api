import {
  buildExchangeFinancialSettlementNotifyMessage,
  buildExchangeFinancialSettlementOrderNote,
  buildExchangeFinancialSettlementTicketBody,
  exchangeInspectionItemLabelForUser,
} from './exchange-financial-settlement-messaging.util';

describe('exchange-financial-settlement-messaging', () => {
  const base = {
    listingItem: 'PASS_WITH_SETTLEMENT',
    offerItem: 'PASS',
    listingNote: 'خراش جزئی',
    offerNote: null as string | null,
    listingSettlementAmount: 500_000,
    offerSettlementAmount: 0,
  };

  it('uses short user-facing item labels', () => {
    expect(exchangeInspectionItemLabelForUser('PASS_WITH_SETTLEMENT')).toBe(
      'تایید با اصلاح مالی',
    );
    expect(exchangeInspectionItemLabelForUser('PASS')).toBe('تایید سلامت');
  });

  it('builds concise order note without flow jargon', () => {
    const note = buildExchangeFinancialSettlementOrderNote(base);
    expect(note).toContain('کارشناسی معاوضه با اصلاح مالی تایید شد');
    expect(note).not.toContain('جریان دقیق');
    expect(note).not.toContain('پرداخت‌کننده');
    expect(note).toMatch(/۵۰۰[٬,]۰۰۰ تومان/);
  });

  it('builds professional ticket body', () => {
    const body = buildExchangeFinancialSettlementTicketBody(base);
    expect(body).toContain('کارشناسی معاوضه انجام شد');
    expect(body).toContain('توضیح (کالای آگهی): خراش جزئی');
    expect(body).not.toContain('→');
  });

  it('builds short push/notify message', () => {
    const msg = buildExchangeFinancialSettlementNotifyMessage('a1b2c3');
    expect(msg).toContain('#A1B2C3');
    expect(msg.length).toBeLessThan(120);
  });
});
