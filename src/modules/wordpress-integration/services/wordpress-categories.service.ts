import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  filterCategoriesSelectableForListing,
  filterCategoriesVisibleOnSite,
  isCategorySelectableForListing,
  isCategoryVisibleOnSite,
} from '../../../common/category-visibility.util';

export interface WordPressCategoryOption {
  id: string;
  title: string;
  /** برچسب نمایشی شامل مسیر والد — مثل فرم ساخت آگهی */
  label: string;
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
    const selectable = filterCategoriesSelectableForListing(visible);
    return this.buildSelectableOptions(selectable, visible);
  }

  async assertCategoryAllowed(categoryId: string): Promise<void> {
    const rows = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    if (!isCategoryVisibleOnSite(categoryId, byId)) {
      throw new BadRequestException('دسته‌بندی انتخاب‌شده در طبقه معتبر یا فعال نیست');
    }
    if (!isCategorySelectableForListing(categoryId, byId)) {
      throw new BadRequestException(
        'دسته‌بندی انتخاب‌شده باید زیردستهٔ نهایی باشد؛ دسته‌های والد قابل انتخاب نیستند',
      );
    }
  }

  private buildSelectableOptions(
    rows: Array<{
      id: string;
      title: string;
      slug: string;
      parentId: string | null;
    }>,
    chainRows: Array<{
      id: string;
      title: string;
      parentId: string | null;
    }>,
  ): WordPressCategoryOption[] {
    const chainById = new Map(chainRows.map((row) => [row.id, row]));

    const depthOf = (id: string): number => {
      let depth = 0;
      let cur = chainById.get(id);
      while (cur?.parentId && chainById.has(cur.parentId)) {
        depth += 1;
        cur = chainById.get(cur.parentId);
      }
      return depth;
    };

    const labelOf = (id: string): string => {
      const titles: string[] = [];
      let cur = chainById.get(id);
      while (cur) {
        titles.unshift(cur.title);
        cur = cur.parentId ? chainById.get(cur.parentId) : undefined;
      }
      if (titles.length <= 1) return titles[0] ?? '';
      return `${titles.slice(0, -1).join(' — ')} — ${titles.at(-1)}`;
    };

    return rows
      .map((row) => ({
        id: row.id,
        title: row.title,
        label: labelOf(row.id),
        slug: row.slug,
        parentId: row.parentId,
        depth: depthOf(row.id),
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'fa'));
  }
}
