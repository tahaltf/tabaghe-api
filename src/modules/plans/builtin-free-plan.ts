import { ListingType } from '@prisma/client';
import type { BuiltinFreePlanDisplayOverrides } from './builtin-free-plan-display';
import {
  BUILTIN_FREE_PLAN_ID,
  normalizePlanBadgeLabel,
  sanitizePlanBadgeColor,
} from './builtin-free-plan-display';

export { BUILTIN_FREE_PLAN_ID } from './builtin-free-plan-display';

const DEFAULT_COPY = {
  title: 'همکف',
  marketingTitle: 'شروع معامله در طبقه',
  description:
    'ورودی بازار طبقه — برای همه فعال است. آگهی فروش و یک معاوضه رایگان، دسترسی به بازار و پرداخت امن میانجی.',
} as const;

export type BuiltinFreeQuotaLimits = {
  direct: number;
  exchange: number;
};

export function buildBuiltinFreePlan(
  limits: BuiltinFreeQuotaLimits,
  overrides?: BuiltinFreePlanDisplayOverrides | null,
) {
  const id = BUILTIN_FREE_PLAN_ID;
  const now = new Date();
  const o = overrides ?? {};
  const direct = Math.max(0, Math.floor(limits.direct));
  const exchange = Math.max(0, Math.floor(limits.exchange));

  const title =
    o.title !== undefined && o.title.trim().length > 0
      ? o.title.trim()
      : DEFAULT_COPY.title;

  const marketingTitle =
    o.marketingTitle !== undefined
      ? o.marketingTitle && o.marketingTitle.trim().length > 0
        ? o.marketingTitle.trim()
        : null
      : DEFAULT_COPY.marketingTitle;

  const description =
    o.description !== undefined
      ? o.description && o.description.trim().length > 0
        ? o.description.trim()
        : null
      : DEFAULT_COPY.description;

  const isActive = o.isActive !== false;

  const badgeLabel =
    o.badgeLabel !== undefined ? normalizePlanBadgeLabel(o.badgeLabel) : null;

  const badgeColor =
    o.badgeColor !== undefined ? sanitizePlanBadgeColor(o.badgeColor) : null;

  const rules: Array<{
    id: string;
    planId: string;
    type: ListingType;
    count: number;
  }> = [
    {
      id: `${id}_direct`,
      planId: id,
      type: ListingType.DIRECT,
      count: direct,
    },
  ];
  if (exchange > 0) {
    rules.push({
      id: `${id}_exchange`,
      planId: id,
      type: ListingType.EXCHANGE,
      count: exchange,
    });
  }

  return {
    id,
    title,
    marketingTitle,
    description,
    price: 0,
    isActive,
    durationDays: 0,
    feeDiscountDirectPercent: 0,
    feeDiscountAuctionPercent: 0,
    badgeLabel,
    badgeColor,
    rules,
    createdAt: now,
    updatedAt: now,
    isBuiltinFree: true as const,
  };
}
