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

  s = s.replace(/\{\{\s*firstName\s*\}\}/gi, fn);
  s = s.replace(/\{\{\s*lastName\s*\}\}/gi, ln);
  s = s.replace(/\{\{\s*listingTitle\s*\}\}/gi, listing);
  s = s.replace(/\{\{\s*adminFirstName\s*\}\}/gi, adminFn);
  s = s.replace(/\{\{\s*title\s*\}\}/gi, title);
  s = s.replace(/\{\{\s*message\s*\}\}/gi, message);

  const meta =
    ctx.meta && typeof ctx.meta === 'object'
      ? (ctx.meta as Record<string, unknown>)
      : {};
  for (const [k, v] of Object.entries(meta)) {
    const val = v === null || v === undefined ? '' : String(v);
    const re = new RegExp(`\\{\\{\\s*${escapeRegExp(k)}\\s*\\}\\}`, 'gi');
    s = s.replace(re, val);
  }
  return s;
}
