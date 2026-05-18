import { LocationType, type PrismaClient } from '@prisma/client';
import { IRAN_LOCATION_SEED } from '../../prisma/seed-data/iran-locations';

/** به‌روزرسانی اسلاگ استان‌ها و شهرها از دادهٔ seed (ایمن برای دیتابیس موجود) */
export async function syncIranLocationSlugs(prisma: PrismaClient): Promise<void> {
  for (const prov of IRAN_LOCATION_SEED) {
    const province = await prisma.location.findFirst({
      where: { name: prov.name, type: 'PROVINCE' },
      select: { id: true },
    });
    if (!province) continue;

    await prisma.location.update({
      where: { id: province.id },
      data: { slug: prov.slug },
    });

    for (const city of prov.cities) {
      const row = await prisma.location.findFirst({
        where: {
          name: city.name,
          type: 'CITY',
          parentId: province.id,
        },
        select: { id: true },
      });
      if (!row) continue;
      await prisma.location.update({
        where: { id: row.id },
        data: { slug: city.slug },
      });
    }
  }
}

/** اسلاگ پیشنهادی برای موقعیت جدید (ادمین) */
export function suggestLocationSlug(
  name: string,
  type: LocationType,
): string {
  const normalized = name
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  const base = normalized.length > 0 ? normalized : 'location';
  return type === 'PROVINCE' ? `ostan-${base}`.slice(0, 120) : base.slice(0, 120);
}

export async function ensureUniqueLocationSlug(
  prisma: PrismaClient,
  baseSlug: string,
): Promise<string> {
  let slug = baseSlug.slice(0, 120);
  let n = 2;
  while (
    await prisma.location.findFirst({
      where: { slug },
      select: { id: true },
    })
  ) {
    slug = `${baseSlug}-${n}`.slice(0, 120);
    n += 1;
  }
  return slug;
}

export async function findLocationBySlug(
  prisma: PrismaClient,
  slug: string,
): Promise<{
  id: string;
  name: string;
  slug: string;
  type: LocationType;
  parent?: { id: string; name: string; slug: string } | null;
} | null> {
  const normalized = String(slug ?? '').trim().toLowerCase();
  if (!normalized) return null;

  const row = await prisma.location.findFirst({
    where: { slug: normalized },
    select: {
      id: true,
      name: true,
      slug: true,
      type: true,
      parent: { select: { id: true, name: true, slug: true } },
    },
  });
  return row;
}
