export type UserNameFields = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
};

export type FormatUserDisplayNameOptions = {
  fallback?: 'phone' | 'guest' | string;
};

export function formatLegalUserName(
  user: UserNameFields | null | undefined,
): string {
  if (!user) return '';
  return `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
}

export function formatUserDisplayName(
  user: UserNameFields | null | undefined,
  options: FormatUserDisplayNameOptions = {},
): string {
  const display = user?.displayName?.trim();
  if (display) return display;

  const legal = formatLegalUserName(user);
  if (legal) return legal;

  const fallback = options.fallback ?? 'phone';
  if (fallback === 'phone') return user?.phone?.trim() ?? '';
  if (fallback === 'guest') return '';
  return fallback;
}

export function formatUserInitials(
  user: UserNameFields | null | undefined,
): string {
  const display = user?.displayName?.trim();
  if (display) {
    const parts = display.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
    }
    return display.slice(0, 2).toUpperCase();
  }

  const first = user?.firstName?.trim()?.[0] ?? '';
  const last = user?.lastName?.trim()?.[0] ?? '';
  return `${first}${last}`.toUpperCase();
}
