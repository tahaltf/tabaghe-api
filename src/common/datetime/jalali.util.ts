/**
 * Jalali conversion (jalaali-js algorithm) for Zohal identity inquiries.
 * Birth dates must be sent as YYYY/MM/DD Jalali.
 */

export type JalaliDateParts = { jy: number; jm: number; jd: number };

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}

function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

function g2d(gy: number, gm: number, gd: number): number {
  let d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  d = d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
  return d;
}

function jalCal(jy: number): { leap: number; gy: number; march: number } {
  const breaks = [
    -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097,
    2192, 2262, 2324, 2394, 2456, 3178,
  ];
  const bl = breaks.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = breaks[0];
  let jump = 0;
  for (let i = 1; i < bl; i += 1) {
    const jm = breaks[i];
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

export function toJalaali(gy: number, gm: number, gd: number): JalaliDateParts {
  const r = jalCal(gy - 621);
  const jdn1 = g2d(gy, gm, gd);
  const jdn0 = g2d(r.gy, 3, r.march);
  let k = jdn1 - jdn0;
  let jy = gy - 621;
  let jm: number;
  let jd: number;
  if (k >= 0) {
    if (k <= 185) {
      jm = 1 + div(k, 31);
      jd = mod(k, 31) + 1;
      return { jy, jm, jd };
    }
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  jm = 7 + div(k, 30);
  jd = mod(k, 30) + 1;
  return { jy, jm, jd };
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `1403/01/01` */
export function formatJalaliSlash(parts: JalaliDateParts): string {
  return `${parts.jy}/${pad2(parts.jm)}/${pad2(parts.jd)}`;
}

export function gregorianUtcDateToJalali(date: Date): string {
  return formatJalaliSlash(
    toJalaali(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()),
  );
}

/**
 * Accepts Gregorian `1990-03-21`, ISO datetime, or Jalali `1370/01/15`.
 * Returns Jalali `YYYY/MM/DD` for Zohal.
 */
export function toZohalJalaliBirthDate(raw: string | Date): string | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return gregorianUtcDateToJalali(raw);
  }
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;

  const dateOnly = trimmed.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (dateOnly) {
    const y = Number(dateOnly[1]);
    const m = Number(dateOnly[2]);
    const d = Number(dateOnly[3]);
    if (y >= 1200 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return `${y}/${pad2(m)}/${pad2(d)}`;
    }
    if (y >= 1800 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      return formatJalaliSlash(toJalaali(y, m, d));
    }
  }

  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return null;
  return gregorianUtcDateToJalali(new Date(parsed));
}
