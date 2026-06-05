export type ExchangeSettlementItemSide = 'listing' | 'offer';

const ITEM_SIDE_LABEL: Record<ExchangeSettlementItemSide, string> = {
  listing: 'کالای آگهی',
  offer: 'کالای پیشنهاد',
};

const PHASE_ACTION_LABEL: Record<string, string> = {
  seller_settlement_debit_available: 'کسر از موجودی قابل برداشت',
  buyer_settlement_blocked: 'افزودن به مبلغ بلوکه',
  seller_settlement_debit_blocked: 'کسر از مبلغ بلوکه معامله',
  buyer_settlement_credit_available: 'واریز به موجودی قابل برداشت',
  buyer_settlement_debit_available: 'کسر از موجودی قابل برداشت',
  seller_settlement_blocked: 'افزودن به مبلغ بلوکه',
  buyer_settlement_debit_blocked: 'کسر از مبلغ بلوکه معامله',
  seller_settlement_credit_available: 'واریز به موجودی قابل برداشت',
};

export function resolveExchangeSettlementItemTitle(
  order: { listing: { title: string } },
  itemSide: ExchangeSettlementItemSide,
  offerTitle?: string,
): string | undefined {
  if (itemSide === 'offer') {
    return offerTitle?.trim() || undefined;
  }
  return order.listing.title?.trim() || undefined;
}

export function buildExchangeSettlementWalletDescription(params: {
  orderId: string;
  itemSide: ExchangeSettlementItemSide;
  itemTitle?: string;
  phase: string;
  amount: number;
}): string {
  const orderShortId = params.orderId.slice(-6).toUpperCase();
  const itemLabel = ITEM_SIDE_LABEL[params.itemSide];
  const action = PHASE_ACTION_LABEL[params.phase] ?? 'اصلاح مالی کارشناسی';
  const amountFa = params.amount.toLocaleString('fa-IR');
  const titlePart = params.itemTitle?.trim()
    ? `«${params.itemTitle.trim()}»`
    : '—';
  return `${action} (${amountFa} تومان) — اصلاح مالی کارشناسی معاوضه · ${itemLabel}: ${titlePart} · سفارش #${orderShortId}`;
}

/** meta غنی برای تراکنش‌های اصلاح مالی معاوضه */
export function buildExchangeSettlementWalletMeta(params: {
  order: { id: string; listing: { id: string; title: string } };
  itemSide: ExchangeSettlementItemSide;
  offerTitle?: string;
  amount: number;
  phase: string;
  kind?: string;
}): Record<string, unknown> {
  const itemTitle = resolveExchangeSettlementItemTitle(
    params.order,
    params.itemSide,
    params.offerTitle,
  );
  const itemLabel = ITEM_SIDE_LABEL[params.itemSide];
  const orderShortId = params.order.id.slice(-6).toUpperCase();
  const action = PHASE_ACTION_LABEL[params.phase] ?? 'اصلاح مالی';
  const description = buildExchangeSettlementWalletDescription({
    orderId: params.order.id,
    itemSide: params.itemSide,
    itemTitle,
    phase: params.phase,
    amount: params.amount,
  });

  return {
    kind: params.kind ?? 'order-escrow',
    phase: params.phase,
    settlementKind: 'exchange-financial-settlement',
    settlementItemSide: params.itemSide,
    settlementItemLabel: itemLabel,
    settlementAction: action,
    settlementReason: 'اصلاح مالی پس از کارشناسی معاوضه در هاب',
    orderId: params.order.id,
    orderShortId,
    listingId: params.order.listing.id,
    ...(itemTitle ? { itemTitle, listingTitle: itemTitle } : {}),
    description,
  };
}
