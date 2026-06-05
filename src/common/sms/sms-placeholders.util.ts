import { getOrderStatusLabelFa } from '../order/order-status-labels.util';

/**
 * جایگزینی متغیرهای قالب پیامک (sms.ir و مشابه).
 * نام placeholderها نسبت به حروف بزرگ/کوچک و فاصلهٔ داخل {{ }} اغماض‌پذیر است.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type SmsPlaceholderContext = {
  firstName?: string | null;
  lastName?: string | null;
  listingTitle?: string;
  adminFirstName?: string | null;
  title?: string;
  message?: string;
  buyerName?: string;
  sellerName?: string;
  buyerPhone?: string;
  sellerPhone?: string;
  amountFormatted?: string;
  meta?: Record<string, unknown>;
};

export function applySmsTemplatePlaceholders(
  raw: string,
  ctx: SmsPlaceholderContext,
): string {
  let s = String(raw ?? '');
  const fn = String(ctx.firstName ?? 'کاربر');
  const ln = String(ctx.lastName ?? '');
  const listing = String(ctx.listingTitle ?? 'یک آگهی');
  const adminFn = String(ctx.adminFirstName ?? 'ادمین');
  const title = String(ctx.title ?? '');
  const message = String(ctx.message ?? '');
  const meta =
    ctx.meta && typeof ctx.meta === 'object'
      ? (ctx.meta as Record<string, unknown>)
      : {};

  s = s.replace(/\{\{\s*firstName\s*\}\}/gi, fn);
  s = s.replace(/\{\{\s*lastName\s*\}\}/gi, ln);
  s = s.replace(/\{\{\s*listingTitle\s*\}\}/gi, listing);
  s = s.replace(/\{\{\s*adminFirstName\s*\}\}/gi, adminFn);
  s = s.replace(/\{\{\s*title\s*\}\}/gi, title);
  s = s.replace(/\{\{\s*message\s*\}\}/gi, message);
  s = s.replace(
    /\{\{\s*note\s*\}\}/gi,
    String(meta['note'] ?? meta['statusNote'] ?? ''),
  );
  s = s.replace(
    /\{\{\s*trackingCode\s*\}\}/gi,
    String(meta['trackingCode'] ?? ''),
  );
  s = s.replace(/\{\{\s*buyerName\s*\}\}/gi, String(ctx.buyerName ?? meta['buyerName'] ?? ''));
  s = s.replace(/\{\{\s*sellerName\s*\}\}/gi, String(ctx.sellerName ?? meta['sellerName'] ?? ''));
  s = s.replace(/\{\{\s*buyerPhone\s*\}\}/gi, String(ctx.buyerPhone ?? meta['buyerPhone'] ?? ''));
  s = s.replace(/\{\{\s*sellerPhone\s*\}\}/gi, String(ctx.sellerPhone ?? meta['sellerPhone'] ?? ''));
  s = s.replace(
    /\{\{\s*amountFormatted\s*\}\}/gi,
    String(ctx.amountFormatted ?? meta['amountFormatted'] ?? meta['amount'] ?? ''),
  );
  s = s.replace(
    /\{\{\s*totalAmountFormatted\s*\}\}/gi,
    String(meta['totalAmountFormatted'] ?? meta['totalAmount'] ?? ''),
  );

  const statusFa =
    String(meta['statusLabel'] ?? meta['statusFa'] ?? meta['orderStatusLabel'] ?? '').trim() ||
    (meta['status'] != null ? getOrderStatusLabelFa(String(meta['status'])) : '');
  if (statusFa) {
    s = s.replace(/\{\{\s*status\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*orderStatus\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*statusLabel\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*orderStatusLabel\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*statusFa\s*\}\}/gi, statusFa);
  }

  for (const [k, v] of Object.entries(meta)) {
    let val = v === null || v === undefined ? '' : String(v);
    if (k === 'status' || k === 'orderStatus') {
      val = getOrderStatusLabelFa(val) || val;
    }
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(k)}\\s*\\}\\}`, 'gi');
    s = s.replace(re, val);
  }
  return s;
}
