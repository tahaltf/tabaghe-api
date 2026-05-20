/** ارقام فارسی/عربی به لاتین برای parse عدد */
const PERSIAN_ARABIC_DIGIT_TO_ASCII: Record<string, string> = {
  '۰': '0',
  '۱': '1',
  '۲': '2',
  '۳': '3',
  '۴': '4',
  '۵': '5',
  '۶': '6',
  '۷': '7',
  '۸': '8',
  '۹': '9',
  '٠': '0',
  '١': '1',
  '٢': '2',
  '٣': '3',
  '٤': '4',
  '٥': '5',
  '٦': '6',
  '٧': '7',
  '٨': '8',
  '٩': '9',
};

function persianDigitsToAscii(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (ch) => PERSIAN_ARABIC_DIGIT_TO_ASCII[ch] ?? ch);
}

/**
 * در متن گواهی، اعداد قبل از «تومان» یا «ریال» را با جداکننده هزارگان (فارسی) قالب می‌کند.
 */
export function formatTomanAmountsInPlainText(text: string): string {
  if (!text) return text;
  if (!/(تومان|ریال)/.test(text)) return text;
  return text.replace(
    /([۰-۹0-9][۰-۹0-9\u066C,\s،٬]*)\s*(تومان|ریال)/g,
    (full, numRaw: string, suffix: string) => {
      const ascii = persianDigitsToAscii(String(numRaw)).replace(
        /[\s\u066C,،٬]/g,
        '',
      );
      if (!/^\d+$/.test(ascii)) return full;
      const n = parseInt(ascii, 10);
      if (!Number.isFinite(n)) return full;
      return `${new Intl.NumberFormat('fa-IR').format(n)} ${suffix}`;
    },
  );
}

/** خطوط حاوی جزئیات مالی/کارمزد که نباید در گواهی تک‌صفحه بیایند */
const INSPECTION_RESULT_FEE_LINE_RES = [
  /کارمزد/i,
  /سود\s*مجموعه/i,
  /کارمزد\s*پلتفرم/i,
  /پلتفرم.*کارمزد/i,
  /هزینهٔ?\s*طبقه/i,
  /هزینهٔ?\s*کارشناسی/i,
  /مبلغ\s*کارشناسی/i,
  /درصد\s*طبقه/i,
  /سهم\s*طبقه/i,
  /پورسانت/i,
];

/**
 * از متن نتیجه کارشناسی، خطوط مربوط به کارمزد و جزئیات مالی اضافی حذف می‌شود.
 */
export function sanitizeInspectionResultForCertificate(text: string): string {
  const t = String(text ?? '').trim();
  if (!t) return t;
  return t
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !INSPECTION_RESULT_FEE_LINE_RES.some((re) => re.test(line)),
    )
    .join('\n')
    .trim();
}
