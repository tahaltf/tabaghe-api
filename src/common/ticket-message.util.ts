/**
 * قالب‌بندی پیام‌های تیکت پشتیبانی (پاراگراف‌های جدا با خط خالی).
 */

/** چند پاراگراف را با خط خالی به هم می‌چسباند (بدون پیشوند ثابت). */
export function formatTicketMessageBody(paragraphs: string[]): string {
  return paragraphs
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length > 0)
    .join('\n\n');
}

/** موضوع کوتاه و یکسان برای تیکت‌های مرتبط با سفارش */
export function buildOrderTicketSubject(
  headline: string,
  orderId: string,
): string {
  const short = orderId.slice(-6).toUpperCase();
  const title = String(headline ?? '').trim() || 'پیگیری سفارش';
  return `${title} · #${short} [ORDER:${orderId}]`;
}

/** متن پیام کاربر/ادمین: فقط trim؛ بدون افزودن سلام خودکار */
export function normalizeTicketMessage(raw: string): string {
  return String(raw ?? '').trim();
}
