import { resolveStatusLabelFa, resolveStatusLabelFromMeta } from '../status/status-labels.util';
import { isListingTitleLikelyId } from '../notification/listing-title-meta.util';

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
  ownerName?: string;
  offerTitle?: string;
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
  const meta =
    ctx.meta && typeof ctx.meta === 'object'
      ? (ctx.meta as Record<string, unknown>)
      : {};
  const fn = String(ctx.firstName ?? 'کاربر');
  const ln = String(ctx.lastName ?? '');
  const metaListingRaw =
    typeof meta['listingTitle'] === 'string' ? meta['listingTitle'].trim() : '';
  const metaListingTitle =
    metaListingRaw &&
    !isListingTitleLikelyId(metaListingRaw, meta['listingId'])
      ? metaListingRaw
      : '';
  const listing = String(
    ctx.listingTitle ?? (metaListingTitle || 'یک آگهی'),
  );
  const adminFn = String(ctx.adminFirstName ?? 'ادمین');
  const title = String(ctx.title ?? '');
  const message = String(ctx.message ?? '');

  s = s.replace(/\{\{\s*firstName\s*\}\}/gi, fn);
  s = s.replace(/\{\{\s*lastName\s*\}\}/gi, ln);
  s = s.replace(/\{\{\s*listingTitle\s*\}\}/gi, listing);
  const batchCount =
    ctx.meta && ctx.meta['batchCount'] != null
      ? String(ctx.meta['batchCount'])
      : '';
  s = s.replace(/\{\{\s*batchCount\s*\}\}/gi, batchCount);
  s = s.replace(/\{\{\s*adminFirstName\s*\}\}/gi, adminFn);
  s = s.replace(/\{\{\s*title\s*\}\}/gi, title);
  s = s.replace(/\{\{\s*message\s*\}\}/gi, message);
  const noteText =
    (typeof meta['note'] === 'string' && meta['note'].trim()
      ? meta['note'].trim()
      : undefined) ??
    (typeof meta['statusNote'] === 'string' && meta['statusNote'].trim()
      ? meta['statusNote'].trim()
      : undefined) ??
    (message.trim() || undefined);
  s = s.replace(/\{\{\s*note\s*\}\}/gi, noteText ?? '');
  s = s.replace(
    /\{\{\s*trackingCode\s*\}\}/gi,
    String(meta['trackingCode'] ?? ''),
  );
  s = s.replace(/\{\{\s*buyerName\s*\}\}/gi, String(ctx.buyerName ?? meta['buyerName'] ?? ''));
  s = s.replace(/\{\{\s*sellerName\s*\}\}/gi, String(ctx.sellerName ?? meta['sellerName'] ?? ''));
  s = s.replace(
    /\{\{\s*ownerName\s*\}\}/gi,
    String(ctx.ownerName ?? meta['ownerName'] ?? meta['sellerName'] ?? ''),
  );
  s = s.replace(
    /\{\{\s*offerTitle\s*\}\}/gi,
    String(ctx.offerTitle ?? meta['offerTitle'] ?? ''),
  );
  s = s.replace(/\{\{\s*buyerPhone\s*\}\}/gi, String(ctx.buyerPhone ?? meta['buyerPhone'] ?? ''));
  s = s.replace(/\{\{\s*sellerPhone\s*\}\}/gi, String(ctx.sellerPhone ?? meta['sellerPhone'] ?? ''));
  s = s.replace(
    /\{\{\s*sellerOrderStatusFa\s*\}\}/gi,
    String(
      meta['sellerOrderStatusFa'] ??
        meta['sellerOrderStatus'] ??
        meta['ownerOrderStatusFa'] ??
        resolveStatusLabelFromMeta(meta as Record<string, unknown>) ??
        '',
    ),
  );
  s = s.replace(
    /\{\{\s*buyerOrderStatusFa\s*\}\}/gi,
    String(
      meta['buyerOrderStatusFa'] ??
        meta['buyerOrderStatus'] ??
        resolveStatusLabelFromMeta(meta as Record<string, unknown>) ??
        '',
    ),
  );
  s = s.replace(
    /\{\{\s*ownerOrderStatusFa\s*\}\}/gi,
    String(
      meta['ownerOrderStatusFa'] ??
        meta['sellerOrderStatusFa'] ??
        meta['sellerOrderStatus'] ??
        resolveStatusLabelFromMeta(meta as Record<string, unknown>) ??
        '',
    ),
  );
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
    (meta['status'] != null
      ? resolveStatusLabelFromMeta(meta as Record<string, unknown>)
      : '');
  if (statusFa) {
    s = s.replace(/\{\{\s*status\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*orderStatus\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*statusLabel\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*orderStatusLabel\s*\}\}/gi, statusFa);
    s = s.replace(/\{\{\s*statusFa\s*\}\}/gi, statusFa);
  }

  for (const [k, v] of Object.entries(meta)) {
    if (k === 'listingTitle' && isListingTitleLikelyId(v, meta['listingId'])) {
      continue;
    }
    let val = v === null || v === undefined ? '' : String(v);
    if (k === 'status' || k === 'orderStatus') {
      val = resolveStatusLabelFa(val) || val;
    }
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(k)}\\s*\\}\\}`, 'gi');
    s = s.replace(re, val);
  }
  return s;
}
