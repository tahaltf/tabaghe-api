export type ParsedPriceLine = {
  lineNumber: number;
  rawLine: string;
  query: string;
  price: number;
};

export type ParsePriceLineFailure = {
  lineNumber: number;
  rawLine: string;
  reason: string;
};

export type ParseBulkPriceTextResult = {
  items: ParsedPriceLine[];
  failures: ParsePriceLineFailure[];
};

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی/عربی → انگلیسی؛ حذف جداکننده هزارگان */
export function toEnglishDigits(input: string): string {
  return String(input ?? '').replace(/[۰-۹٠-٩]/g, (ch) => {
    const p = PERSIAN_DIGITS.indexOf(ch);
    if (p >= 0) return String(p);
    const a = ARABIC_DIGITS.indexOf(ch);
    return a >= 0 ? String(a) : ch;
  });
}

export function normalizeListingTitleKey(title: string): string {
  return String(title ?? '')
    .trim()
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** قیمت تومان؛ ۰ یعنی ناموجود */
export function parsePriceAmount(raw: string): number | null {
  const cleaned = toEnglishDigits(raw)
    .replace(/[,\u066C\u060C\u200F\u200E]/g, '')
    .replace(/\s+/g, '')
    .replace(/تومان|تومن|ریال|irr|tmn/gi, '')
    .trim();
  if (!cleaned) return null;
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * هر خط: «عنوان یا شناسه = قیمت» یا با «:»
 * خط خالی و خط‌هایی که با # شروع شوند نادیده گرفته می‌شوند.
 */
export function parseBulkPriceText(text: string): ParseBulkPriceTextResult {
  const items: ParsedPriceLine[] = [];
  const failures: ParsePriceLineFailure[] = [];
  const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const sepMatch = trimmed.match(/^(.+?)\s*[=:]\s*(.+)$/);
    if (!sepMatch) {
      failures.push({
        lineNumber,
        rawLine: trimmed,
        reason: 'فرمت نامعتبر؛ باید به شکل «عنوان = قیمت» باشد',
      });
      return;
    }

    const query = sepMatch[1].trim();
    const price = parsePriceAmount(sepMatch[2]);
    if (!query) {
      failures.push({
        lineNumber,
        rawLine: trimmed,
        reason: 'عنوان یا شناسه خالی است',
      });
      return;
    }
    if (price == null) {
      failures.push({
        lineNumber,
        rawLine: trimmed,
        reason: 'قیمت نامعتبر است',
      });
      return;
    }

    items.push({ lineNumber, rawLine: trimmed, query, price });
  });

  return { items, failures };
}
