import type { PrismaClient } from '@prisma/client';

const RESERVED_SHOP_SLUGS = new Set(['new', 'me', 'admin', 'shop', 'seller']);

export function normalizeShopSlug(raw: string): string {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 48);
}

/**
 * اسلاگ فروشگاه باید از نام نمایشی ساخته شود.
 * فقط اگر نام نمایشی خالی باشد از نام (firstName) به‌عنوان پشتیبان استفاده می‌شود.
 */
export function shopSlugBaseFromName(
  displayName?: string | null,
  firstName?: string | null,
): string {
  const fromDisplay = String(displayName ?? '').trim();
  const source = fromDisplay || String(firstName ?? '').trim();
  const normalized = normalizeShopSlug(source);
  if (!normalized || RESERVED_SHOP_SLUGS.has(normalized)) return 'shop';
  return normalized;
}

function slugMatchesPreferredBase(slug: string, base: string): boolean {
  const current = normalizeShopSlug(slug);
  const preferred = normalizeShopSlug(base);
  if (!current || !preferred) return false;
  if (current === preferred) return true;
  const suffix = current.slice(preferred.length);
  return current.startsWith(preferred) && /^-\d+$/.test(suffix);
}

export async function ensureUniqueShopSlug(
  prisma: PrismaClient,
  baseSlug: string,
  excludeUserId?: string,
): Promise<string> {
  const base = normalizeShopSlug(baseSlug) || 'shop';
  let slug = base;
  let n = 2;
  while (true) {
    const existing = await prisma.user.findFirst({
      where: {
        shopSlug: { equals: slug, mode: 'insensitive' },
        ...(excludeUserId ? { id: { not: excludeUserId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return slug;
    slug = `${base}-${n}`.slice(0, 56);
    n += 1;
  }
}

export async function ensureUserShopSlug(
  prisma: PrismaClient,
  user: {
    id: string;
    shopSlug: string | null;
    displayName: string | null;
    firstName: string | null;
  },
): Promise<string> {
  const preferredBase = shopSlugBaseFromName(user.displayName, user.firstName);
  const hasDisplayName = Boolean(user.displayName?.trim());

  if (user.shopSlug) {
    // اگر نام نمایشی ست شده، اسلاگ باید با آن هم‌خوان باشد؛ در غیر این صورت نگه می‌داریم.
    if (!hasDisplayName || slugMatchesPreferredBase(user.shopSlug, preferredBase)) {
      return user.shopSlug;
    }
  }

  const slug = await ensureUniqueShopSlug(prisma, preferredBase, user.id);
  if (user.shopSlug === slug) return slug;

  await prisma.user.update({
    where: { id: user.id },
    data: { shopSlug: slug },
  });
  return slug;
}
