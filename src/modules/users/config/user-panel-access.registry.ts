export const USER_PANEL_ACCESS_KEYS = [
  'dashboard.ads',
  'dashboard.orders',
  'dashboard.chats',
  'dashboard.wallet',
  'dashboard.wallet.withdraw',
  'dashboard.repairs',
  'dashboard.invite',
  'dashboard.plans',
  'dashboard.support',
  'dashboard.contentStudio',
  'listing.create',
  'listing.auction',
  'listing.exchange',
  'settings.telegram',
  'settings.wordpress',
] as const;

export type UserPanelAccessKey = (typeof USER_PANEL_ACCESS_KEYS)[number];

export type UserPanelAccessMap = Record<UserPanelAccessKey, boolean>;

export function isUserPanelAccessKey(key: string): key is UserPanelAccessKey {
  return (USER_PANEL_ACCESS_KEYS as readonly string[]).includes(key);
}

export function defaultPanelAccessMap(): UserPanelAccessMap {
  return Object.fromEntries(
    USER_PANEL_ACCESS_KEYS.map((key) => [key, true]),
  ) as UserPanelAccessMap;
}
