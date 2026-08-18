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

export function shopSlugBaseFromName(
  displayName?: string | null,
  firstName?: string | null,
): string {
  const source = String(displayName || firstName || '').trim();
  const normalized = normalizeShopSlug(source);
  if (!normalized || RESERVED_SHOP_SLUGS.has(normalized)) return 'shop';
  return normalized;
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
  if (user.shopSlug) return user.shopSlug;
  const slug = await ensureUniqueShopSlug(
    prisma,
    shopSlugBaseFromName(user.displayName, user.firstName),
    user.id,
  );
  await prisma.user.update({
    where: { id: user.id },
    data: { shopSlug: slug },
  });
  return slug;
}
