/**
 * قالب‌بندی یکپارچه پیام‌های تیکت پشتیبانی (سلام؛ + پاراگراف‌های جدا).
 */

/** بدنهٔ تیکت با سلام فارسی و پاراگراف‌های جدا */
export function formatTicketMessageBody(paragraphs: string[]): string {
  const body = paragraphs
    .map((p) => String(p ?? '').trim())
    .filter((p) => p.length > 0);
  if (!body.length) {
    return 'سلام؛';
  }
  return ['سلام؛', ...body].join('\n\n');
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

/** پیام کاربر یا ادمین: اگر سلام ندارد اضافه می‌شود؛ «سلام،» قدیمی به «سلام؛» تبدیل می‌شود */
export function normalizeTicketMessage(raw: string): string {
  const text = String(raw ?? '').trim();
  if (!text) {
    return 'سلام؛';
  }
  const withoutGreeting = text.replace(/^سلام\s*[؛،,:]\s*/u, '').trim();
  if (/^سلام\s*[؛،,:]/u.test(text)) {
    return formatTicketMessageBody(
      withoutGreeting ? [withoutGreeting] : [],
    );
  }
  return formatTicketMessageBody([text]);
}
