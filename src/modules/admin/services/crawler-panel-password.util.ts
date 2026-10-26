import { randomBytes } from 'crypto';

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%^&*-_=+';
const ALL = UPPER + LOWER + DIGITS + SYMBOLS;

function pick(charset: string): string {
  const buf = randomBytes(1);
  return charset[buf[0]! % charset.length]!;
}

/** Strong random password (~20 chars, mixed classes) for crawler panel users. */
export function generateCrawlerPanelPassword(length = 20): string {
  const n = Math.max(16, Math.min(48, length));
  const chars = [pick(UPPER), pick(LOWER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < n) {
    chars.push(pick(ALL));
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join('');
}

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9._-]{2,39}$/;

export function normalizeCrawlerUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertValidCrawlerUsername(username: string): void {
  if (!USERNAME_RE.test(username)) {
    throw new Error(
      'نام کاربری باید با حرف شروع شود و ۳ تا ۴۰ کاراکتر (حرف، عدد، . _ -) باشد',
    );
  }
}
