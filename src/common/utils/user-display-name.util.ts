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

/** حرف اول نام کوچک برای آواتار — بدون چسباندن به نام خانوادگی. */
export function formatUserInitials(
  user: UserNameFields | null | undefined,
): string {
  const first = user?.firstName?.trim();
  if (first) return avatarInitialChar(first);

  const display = user?.displayName?.trim();
  if (display) {
    const firstPart = display.split(/\s+/).filter(Boolean)[0] ?? display;
    return avatarInitialChar(firstPart);
  }

  const last = user?.lastName?.trim();
  if (last) return avatarInitialChar(last);

  return '';
}

function avatarInitialChar(word: string): string {
  const ch = word[0] ?? '';
  return /[A-Za-z]/.test(ch) ? ch.toUpperCase() : ch;
}
