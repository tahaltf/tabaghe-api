import { formatTicketMessageBody } from '../ticket-message.util';

export type ExchangeFinancialSettlementMessagingInput = {
  listingItem: string;
  offerItem: string;
  listingNote?: string | null;
  offerNote?: string | null;
  listingSettlementAmount: number;
  offerSettlementAmount: number;
};

/** برچسب کوتاه نتیجه کارشناسی برای کاربر */
export function exchangeInspectionItemLabelForUser(code: string): string {
  if (code === 'PASS') return 'تایید سلامت';
  if (code === 'FAIL') return 'رد کارشناسی';
  if (code === 'PASS_WITH_SETTLEMENT') return 'تایید با اصلاح مالی';
  return code;
}

function formatTomanFa(amount: number): string {
  if (!Number.isFinite(amount) || amount <= 0) return '';
  return `${amount.toLocaleString('fa-IR')} تومان`;
}

/** یادداشت داخلی سفارش (cancelReason) — خلاصه و خوانا */
export function buildExchangeFinancialSettlementOrderNote(
  input: ExchangeFinancialSettlementMessagingInput,
): string {
  const lines = [
    'کارشناسی معاوضه با اصلاح مالی تایید شد. سفارش برای ارسال از هاب آماده است.',
    `کالای آگهی: ${exchangeInspectionItemLabelForUser(input.listingItem)}`,
    `کالای پیشنهاد: ${exchangeInspectionItemLabelForUser(input.offerItem)}`,
  ];
  if (input.listingSettlementAmount > 0) {
    lines.push(
      `اصلاح مالی کالای آگهی: ${formatTomanFa(input.listingSettlementAmount)}`,
    );
  }
  if (input.offerSettlementAmount > 0) {
    lines.push(
      `اصلاح مالی کالای پیشنهاد: ${formatTomanFa(input.offerSettlementAmount)}`,
    );
  }
  const reason = [input.listingNote?.trim(), input.offerNote?.trim()]
    .filter(Boolean)
    .join(' — ');
  if (reason) lines.push(`توضیح کارشناسی: ${reason}`);
  return lines.join('\n');
}

/** متن رسمی تیکت پشتیبانی */
export function buildExchangeFinancialSettlementTicketBody(
  input: ExchangeFinancialSettlementMessagingInput,
): string {
  const parts: string[] = [
    'کارشناسی معاوضه انجام شد و معامله با اصلاح مالی تایید شده است.',
  ];

  const listingResult = exchangeInspectionItemLabelForUser(input.listingItem);
  if (input.listingSettlementAmount > 0) {
    parts.push(
      `کالای آگهی: ${listingResult} — اصلاح مالی ${formatTomanFa(input.listingSettlementAmount)}`,
    );
  } else {
    parts.push(`کالای آگهی: ${listingResult}`);
  }
  if (input.listingNote?.trim()) {
    parts.push(`توضیح (کالای آگهی): ${input.listingNote.trim()}`);
  }

  const offerResult = exchangeInspectionItemLabelForUser(input.offerItem);
  if (input.offerSettlementAmount > 0) {
    parts.push(
      `کالای پیشنهاد: ${offerResult} — اصلاح مالی ${formatTomanFa(input.offerSettlementAmount)}`,
    );
  } else {
    parts.push(`کالای پیشنهاد: ${offerResult}`);
  }
  if (input.offerNote?.trim()) {
    parts.push(`توضیح (کالای پیشنهاد): ${input.offerNote.trim()}`);
  }

  parts.push(
    'سفارش برای ارسال از هاب آماده است. پرسش‌ها را از همین تیکت پیگیری کنید.',
  );
  return formatTicketMessageBody(parts);
}

export const EXCHANGE_FINANCIAL_SETTLEMENT_TICKET_SUBJECT =
  'کارشناسی معاوضه — تایید با اصلاح مالی';

export const EXCHANGE_FINANCIAL_SETTLEMENT_NOTIFY_TITLE =
  'تایید کارشناسی با اصلاح مالی';

export function buildExchangeFinancialSettlementNotifyMessage(
  orderShortId: string,
): string {
  return `کارشناسی معاوضه سفارش #${orderShortId.toUpperCase()} با اصلاح مالی تایید شد. سفارش برای ارسال از هاب آماده است.`;
}

export function buildExchangeFinancialSettlementTicketNotifyMessage(
  orderShortId: string,
): string {
  return `تیکت کارشناسی معاوضه سفارش #${orderShortId.toUpperCase()} باز شد. جزئیات در تیکت پشتیبانی ثبت شده است.`;
}

export interface ExchangeSurplusOfferLike {
  extraPayment: unknown;
  isPayerMe: boolean;
}

export interface ExchangeSurplusReceivableBases {
  extra: number;
  sellerBefore: number;
  buyerBefore: number;
}

/** سهم سرک (مابه‌التفاوت) قابل دریافت هر طرف — نه مجموع پرداخت‌های کیف پول/درگاه. */
export function resolveExchangeSurplusReceivableBases(
  offer: ExchangeSurplusOfferLike,
): ExchangeSurplusReceivableBases {
  const extra = Math.max(0, Number(offer.extraPayment || 0));
  const sellerBefore = offer.isPayerMe ? extra : 0;
  const buyerBefore = !offer.isPayerMe ? extra : 0;
  return { extra, sellerBefore, buyerBefore };
}

export interface ExchangeFinancialSettlementAmounts {
  listingSettlementAmount: number;
  offerSettlementAmount: number;
}

export interface ExchangeFinancialSettlementResult {
  sellerAfter: number;
  buyerAfter: number;
}

/**
 * اصلاح مالی معاوضه روی سهم سرک اعمال می‌شود:
 * - listingSettlementAmount: از فروشنده کم و به خریدار اضافه
 * - offerSettlementAmount: از خریدار کم و به فروشنده اضافه
 */
export function applyExchangeFinancialSettlement(
  bases: ExchangeSurplusReceivableBases,
  amounts: ExchangeFinancialSettlementAmounts,
): ExchangeFinancialSettlementResult {
  const listingSettlementAmount = Math.max(
    0,
    Number(amounts.listingSettlementAmount || 0),
  );
  const offerSettlementAmount = Math.max(
    0,
    Number(amounts.offerSettlementAmount || 0),
  );
  const sellerAfter = Math.max(
    0,
    bases.sellerBefore - listingSettlementAmount + offerSettlementAmount,
  );
  const buyerAfter = Math.max(
    0,
    bases.buyerBefore + listingSettlementAmount - offerSettlementAmount,
  );
  return { sellerAfter, buyerAfter };
}
