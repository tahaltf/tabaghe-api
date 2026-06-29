import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TtlCacheService } from '../../infrastructure/cache/ttl-cache.service';

type ChildrenMapPayload = { entries: Array<[string | null, string[]]> };

const CACHE_KEY = 'category:children-by-parent';
const CACHE_TTL_SECONDS = 120;

@Injectable()
export class CategoryTreeCacheService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: TtlCacheService,
  ) {}

  async resolveDescendantIdsBySlug(slug: string): Promise<string[]> {
    const normalized = slug.trim().toLowerCase();
    if (!normalized) return [];
    const row = await this.prisma.category.findFirst({
      where: { slug: normalized },
      select: { id: true },
    });
    if (!row) return [];
    return this.resolveDescendantIds(row.id);
  }

  async resolveDescendantIds(categoryId: string): Promise<string[]> {
    const map = await this.getChildrenByParent();
    const ids = new Set<string>([categoryId]);
    const queue = [categoryId];
    while (queue.length) {
      const current = queue.shift()!;
      for (const childId of map.get(current) ?? []) {
        if (!ids.has(childId)) {
          ids.add(childId);
          queue.push(childId);
        }
      }
    }
    return [...ids];
  }

  private async getChildrenByParent(): Promise<Map<string | null, string[]>> {
    const payload = await this.cache.getOrSet<ChildrenMapPayload>(
      CACHE_KEY,
      CACHE_TTL_SECONDS,
      async () => {
        const rows = await this.prisma.category.findMany({
          select: { id: true, parentId: true },
        });
        const map = new Map<string | null, string[]>();
        for (const row of rows) {
          const key = row.parentId;
          const list = map.get(key) ?? [];
          list.push(row.id);
          map.set(key, list);
        }
        return { entries: [...map.entries()] };
      },
    );
    if (!Array.isArray(payload?.entries)) {
      await this.cache.delete(CACHE_KEY);
      return this.getChildrenByParent();
    }
    return new Map(payload.entries);
  }
}
