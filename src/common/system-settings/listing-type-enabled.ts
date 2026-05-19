import { ListingType } from '@prisma/client';

export const LISTING_TYPE_ENABLED_SETTING_KEYS = {
  DIRECT: 'LISTING_TYPE_DIRECT_ENABLED',
  EXCHANGE: 'LISTING_TYPE_EXCHANGE_ENABLED',
  AUCTION: 'LISTING_TYPE_AUCTION_ENABLED',
} as const;

export type ListingTypeEnabledSettingKey =
  (typeof LISTING_TYPE_ENABLED_SETTING_KEYS)[keyof typeof LISTING_TYPE_ENABLED_SETTING_KEYS];

export const ALL_LISTING_TYPE_ENABLED_SETTING_KEYS = Object.values(
  LISTING_TYPE_ENABLED_SETTING_KEYS,
);

export interface ListingTypesEnabled {
  direct: boolean;
  exchange: boolean;
  auction: boolean;
}

/** مقدار خالی = فعال (سازگاری با نصب‌های قبلی). */
export function parseSettingBool(
  value: string | undefined | null,
  defaultValue = true,
): boolean {
  if (value === undefined || value === null || String(value).trim() === '') {
    return defaultValue;
  }
  return String(value).trim().toLowerCase() === 'true';
}

export function parseListingTypesEnabledFromMap(
  map: Record<string, string>,
): ListingTypesEnabled {
  return {
    direct: parseSettingBool(
      map[LISTING_TYPE_ENABLED_SETTING_KEYS.DIRECT],
    ),
    exchange: parseSettingBool(
      map[LISTING_TYPE_ENABLED_SETTING_KEYS.EXCHANGE],
    ),
    auction: parseSettingBool(
      map[LISTING_TYPE_ENABLED_SETTING_KEYS.AUCTION],
    ),
  };
}

export function isListingTypeEnabled(
  type: ListingType,
  enabled: ListingTypesEnabled,
): boolean {
  switch (type) {
    case ListingType.DIRECT:
      return enabled.direct;
    case ListingType.EXCHANGE:
      return enabled.exchange;
    case ListingType.AUCTION:
      return enabled.auction;
    default:
      return false;
  }
}

export function listingTypePersianLabel(type: ListingType): string {
  switch (type) {
    case ListingType.DIRECT:
      return 'فروش مستقیم';
    case ListingType.EXCHANGE:
      return 'معاوضه';
    case ListingType.AUCTION:
      return 'مزایده';
    default:
      return 'این نوع معامله';
  }
}
