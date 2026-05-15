import { ListingType } from '@prisma/client';

/** شناسهٔ ثابت پلن رایگان سامانه (در دیتابیس ذخیره نمی‌شود). */
export const BUILTIN_FREE_PLAN_ID = 'builtin_free_plan';

/** JSON در SystemSetting برای متن/بدج/فعال بودن پلن رایگان داخلی */
export const BUILTIN_FREE_PLAN_DISPLAY_KEY = 'BUILTIN_FREE_PLAN_DISPLAY';

export type BuiltinFreePlanDisplayOverrides = {
  title?: string;
  marketingTitle?: string | null;
  description?: string | null;
  badgeLabel?: string | null;
  badgeColor?: string | null;
  /** اگر false باشد پلن رایگان در API عمومی لیست نمی‌شود */
  isActive?: boolean;
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function parseBuiltinFreePlanDisplay(
  raw: string | null | undefined,
): BuiltinFreePlanDisplayOverrides {
  if (!raw?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return {};
    const o = parsed;
    const out: BuiltinFreePlanDisplayOverrides = {};
    if (typeof o.title === 'string') out.title = o.title;
    if (o.marketingTitle === null) out.marketingTitle = null;
    else if (typeof o.marketingTitle === 'string') out.marketingTitle = o.marketingTitle;
    if (o.description === null) out.description = null;
    else if (typeof o.description === 'string') out.description = o.description;
    if (o.badgeLabel === null) out.badgeLabel = null;
    else if (typeof o.badgeLabel === 'string') out.badgeLabel = o.badgeLabel;
    if (o.badgeColor === null) out.badgeColor = null;
    else if (typeof o.badgeColor === 'string') out.badgeColor = o.badgeColor;
    if (typeof o.isActive === 'boolean') out.isActive = o.isActive;
    return out;
  } catch {
    return {};
  }
}

/** فقط هگز ۳ یا ۶ رقمی برای جلوگیری از تزریق در استایل */
export function sanitizePlanBadgeColor(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (!t) return null;
  if (/^#[0-9a-fA-F]{3}$/.test(t) || /^#[0-9a-fA-F]{6}$/.test(t)) {
    return t.toLowerCase();
  }
  return null;
}

export function normalizePlanBadgeLabel(
  input: string | null | undefined,
): string | null {
  if (input == null) return null;
  const t = input.trim();
  if (!t) return null;
  return t.length > 48 ? t.slice(0, 48) : t;
}

export function buildBuiltinAdminRuleRows(limits: {
  direct: number;
  exchange: number;
}): Array<{ id: string; planId: string; type: ListingType; count: number }> {
  const id = BUILTIN_FREE_PLAN_ID;
  const direct = Math.max(0, Math.floor(limits.direct));
  const exchange = Math.max(0, Math.floor(limits.exchange));
  return [
    {
      id: `${id}_direct`,
      planId: id,
      type: ListingType.DIRECT,
      count: direct,
    },
    {
      id: `${id}_exchange`,
      planId: id,
      type: ListingType.EXCHANGE,
      count: exchange,
    },
    {
      id: `${id}_auction`,
      planId: id,
      type: ListingType.AUCTION,
      count: 0,
    },
  ];
}
