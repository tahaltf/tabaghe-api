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
  'dashboard.marketing',
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

/** Pure resolver — safe to use outside UsersModule (e.g. AiTokenModule). */
export function resolveUserPanelAccessMap(
  raw: unknown,
  options?: { aiContentDefault?: boolean },
): UserPanelAccessMap {
  const resolved = defaultPanelAccessMap();
  if (options?.aiContentDefault === false) {
    resolved['dashboard.contentStudio'] = false;
  }

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return resolved;
  }

  const stored = raw as Record<string, unknown>;
  for (const key of USER_PANEL_ACCESS_KEYS) {
    const value = stored[key];
    if (value === false) resolved[key] = false;
    else if (value === true) resolved[key] = true;
  }
  return resolved;
}
