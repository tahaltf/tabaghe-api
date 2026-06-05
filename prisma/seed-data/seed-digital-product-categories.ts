import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { PrismaClient } from '@prisma/client';

function resolveDigitalCategoriesJsonPath(): string {
  const candidates = [
    join(__dirname, 'digital-product-categories.json'),
    join(process.cwd(), 'prisma/seed-data/digital-product-categories.json'),
    join(__dirname, '../../../prisma/seed-data/digital-product-categories.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `digital-product-categories.json not found. Tried: ${candidates.join(', ')}`,
  );
}

type DigitalSub = { name: string; slug: string; children?: string[] };
type DigitalRoot = {
  name: string;
  slug: string;
  icon: string;
  subCategories: DigitalSub[];
};

/** اسلاگ پایدار برای زیردستهٔ سوم از روی عنوان فارسی/لاتین */
function slugifySegment(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function makeChildSlug(parentSubSlug: string, title: string, index: number): string {
  const seg = slugifySegment(title);
  const base = seg.length > 0 ? `${parentSubSlug}-${seg}` : `${parentSubSlug}-n${index}`;
  return base.slice(0, 120);
}

/**
 * درخت دسته‌های «کالای دیجیتال» از JSON (ریشه → زیردسته → فرزند).
 * با upsert و slug یکتا؛ در دیتابیس پر از آگهی هم امن است.
 */
export async function seedDigitalProductCategoryTree(
  prisma: PrismaClient,
): Promise<void> {
  const jsonPath = resolveDigitalCategoriesJsonPath();
  const roots = JSON.parse(
    readFileSync(jsonPath, 'utf8'),
  ) as DigitalRoot[];

  for (const root of roots) {
    const r = await prisma.category.upsert({
      where: { slug: root.slug },
      create: {
        title: root.name,
        slug: root.slug,
        icon: root.icon ?? null,
        parentId: null,
      },
      update: {
        title: root.name,
        icon: root.icon ?? null,
        parentId: null,
      },
    });

    for (const sub of root.subCategories ?? []) {
      const s = await prisma.category.upsert({
        where: { slug: sub.slug },
        create: {
          title: sub.name,
          slug: sub.slug,
          parentId: r.id,
        },
        update: {
          title: sub.name,
          parentId: r.id,
        },
      });

      const usedSlugs = new Set<string>();
      let idx = 0;
      for (const childTitle of sub.children ?? []) {
        let slug = makeChildSlug(sub.slug, childTitle, idx);
        let n = 0;
        while (usedSlugs.has(slug)) {
          slug = `${makeChildSlug(sub.slug, childTitle, idx)}-${++n}`.slice(0, 120);
        }
        usedSlugs.add(slug);

        await prisma.category.upsert({
          where: { slug },
          create: {
            title: childTitle,
            slug,
            parentId: s.id,
          },
          update: {
            title: childTitle,
            parentId: s.id,
          },
        });
        idx += 1;
      }
    }
  }
}
