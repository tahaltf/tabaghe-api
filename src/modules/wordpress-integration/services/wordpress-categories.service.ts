import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  filterCategoriesVisibleOnSite,
  isCategoryVisibleOnSite,
} from '../../../common/category-visibility.util';

export interface WordPressCategoryOption {
  id: string;
  title: string;
  slug: string;
  parentId: string | null;
  depth: number;
}

@Injectable()
export class WordPressCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForPlugin(): Promise<WordPressCategoryOption[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      orderBy: { title: 'asc' },
      select: {
        id: true,
        title: true,
        slug: true,
        parentId: true,
        isActive: true,
      },
    });

    const visible = filterCategoriesVisibleOnSite(rows);
    return this.flattenWithDepth(visible);
  }

  async assertCategoryAllowed(categoryId: string): Promise<void> {
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (!isCategoryVisibleOnSite(categoryId, byId)) {
      throw new BadRequestException('دسته‌بندی انتخاب‌شده در طبقه معتبر یا فعال نیست');
    }
  }

  private flattenWithDepth(
    rows: Array<{
      id: string;
      title: string;
      slug: string;
      parentId: string | null;
    }>,
  ): WordPressCategoryOption[] {
    const byParent = new Map<string | null, typeof rows>();

    for (const row of rows) {
      const key = row.parentId;
      const bucket = byParent.get(key) ?? [];
      bucket.push(row);
      byParent.set(key, bucket);
    }

    const result: WordPressCategoryOption[] = [];

    const walk = (parentId: string | null, depth: number): void => {
      const children = byParent.get(parentId) ?? [];
      children.sort((a, b) => a.title.localeCompare(b.title, 'fa'));

      for (const child of children) {
        result.push({
          id: child.id,
          title: child.title,
          slug: child.slug,
          parentId: child.parentId,
          depth,
        });
        walk(child.id, depth + 1);
      }
    };

    walk(null, 0);
    return result;
  }
}
