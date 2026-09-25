import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CategoryTreeCacheService } from '../../../common/category/category-tree-cache.service';
import { TtlCacheService } from '../../../infrastructure/cache/ttl-cache.service';
import {
  CreateCategoryDto,
  SetCategoryActiveDto,
  BulkSetCategoryActiveDto,
  BulkUpdateCategoryFeesDto,
  UpdateCategoryDto,
} from '../dto/admin-category.dto';
import { AdminListingDeleteService } from './admin-listing-delete.service';

const CATEGORY_SELECT = {
  id: true,
  title: true,
  slug: true,
  icon: true,
  parentId: true,
  feePercentage: true,
  feeCap: true,
  feePercentageDirect: true,
  feeCapDirect: true,
  feePercentageAuction: true,
  feeCapAuction: true,
  auctionDepositPercent: true,
  feePercentageDirectNew: true,
  feePercentageDirectUsed: true,
  feePercentageAuctionNew: true,
  feePercentageAuctionUsed: true,
  auctionDepositPercentNew: true,
  auctionDepositPercentUsed: true,
  isActive: true,
  createdAt: true,
  parent: { select: { id: true, title: true, isActive: true } },
  _count: { select: { listings: true, children: true } },
} satisfies Prisma.CategorySelect;

export type AdminCategoryItem = Prisma.CategoryGetPayload<{
  select: typeof CATEGORY_SELECT;
}>;

export type CategoryForceDeleteResult = {
  categories: number;
  listings: number;
  details: Record<string, number>;
};

@Injectable()
export class AdminCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly listingDelete: AdminListingDeleteService,
    private readonly categoryTree: CategoryTreeCacheService,
    private readonly cache: TtlCacheService,
  ) {}

  async list(search?: string): Promise<AdminCategoryItem[]> {
    const where: Prisma.CategoryWhereInput = {};
    if (search) {
      const s = search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { slug: { contains: s, mode: 'insensitive' } },
      ];
    }
    return this.prisma.category.findMany({
      where,
      select: CATEGORY_SELECT,
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
    });
  }

  async detail(id: string): Promise<AdminCategoryItem> {
    const cat = await this.prisma.category.findUnique({
      where: { id },
      select: CATEGORY_SELECT,
    });
    if (!cat) throw new NotFoundException('دسته‌بندی یافت نشد');
    return cat;
  }

  async create(dto: CreateCategoryDto): Promise<AdminCategoryItem> {
    await this.ensureSlugUnique(dto.slug);
    if (dto.parentId) {
      await this.ensureParentExists(dto.parentId);
    }
    const feeDirectNew =
      dto.feePercentageDirectNew ??
      dto.feePercentageDirect ??
      dto.feePercentage ??
      5;
    const feeDirectUsed =
      dto.feePercentageDirectUsed ??
      dto.feePercentageDirect ??
      dto.feePercentage ??
      feeDirectNew;
    const feeAuctionNew =
      dto.feePercentageAuctionNew ??
      dto.feePercentageAuction ??
      dto.feePercentage ??
      5;
    const feeAuctionUsed =
      dto.feePercentageAuctionUsed ??
      dto.feePercentageAuction ??
      dto.feePercentage ??
      feeAuctionNew;
    const depositNew =
      dto.auctionDepositPercentNew ?? dto.auctionDepositPercent ?? 10;
    const depositUsed =
      dto.auctionDepositPercentUsed ?? dto.auctionDepositPercent ?? depositNew;
    const capDirect = dto.feeCapDirect ?? dto.feeCap ?? 10_000_000;
    const capAuction = dto.feeCapAuction ?? dto.feeCap ?? 500000;
    const created = await this.prisma.category.create({
      data: {
        title: dto.title,
        slug: dto.slug,
        icon: dto.icon ?? null,
        parentId: dto.parentId ?? null,
        feePercentage: dto.feePercentage ?? feeDirectNew,
        feeCap: dto.feeCap ?? capDirect,
        feePercentageDirect: feeDirectNew,
        feeCapDirect: capDirect,
        feePercentageAuction: feeAuctionNew,
        feeCapAuction: capAuction,
        auctionDepositPercent: depositNew,
        feePercentageDirectNew: feeDirectNew,
        feePercentageDirectUsed: feeDirectUsed,
        feePercentageAuctionNew: feeAuctionNew,
        feePercentageAuctionUsed: feeAuctionUsed,
        auctionDepositPercentNew: depositNew,
        auctionDepositPercentUsed: depositUsed,
        isActive: dto.isActive ?? true,
      },
      select: CATEGORY_SELECT,
    });
    await this.invalidateCategoryCaches();
    return created;
  }

  async setActive(id: string, dto: SetCategoryActiveDto): Promise<{ id: string; isActive: boolean; affected: number }> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('دسته‌بندی یافت نشد');

    if (dto.isActive) {
      if (existing.parentId) {
        const parent = await this.prisma.category.findUnique({
          where: { id: existing.parentId },
          select: { isActive: true, title: true },
        });
        if (parent && !parent.isActive) {
          throw new BadRequestException(
            `ابتدا دسته والد «${parent.title}» را فعال کنید`,
          );
        }
      }
      if (dto.includeDescendants) {
        const subtreeIds = await this.collectSubtreeIdsRootFirst([id]);
        const result = await this.prisma.category.updateMany({
          where: { id: { in: subtreeIds } },
          data: { isActive: true },
        });
        await this.invalidateCategoryCaches();
        return { id, isActive: true, affected: result.count };
      }
      await this.prisma.category.update({
        where: { id },
        data: { isActive: true },
      });
      await this.invalidateCategoryCaches();
      return { id, isActive: true, affected: 1 };
    }

    const subtreeIds = await this.collectSubtreeIdsRootFirst([id]);
    const result = await this.prisma.category.updateMany({
      where: { id: { in: subtreeIds } },
      data: { isActive: false },
    });
    await this.invalidateCategoryCaches();
    return { id, isActive: false, affected: result.count };
  }

  /**
   * Bulk activate/deactivate selected categories.
   * Deactivate always expands to full subtrees.
   * Activate processes root-first so a parent and its children in the same batch both work.
   */
  async bulkSetActive(
    dto: BulkSetCategoryActiveDto,
  ): Promise<{ affected: number; isActive: boolean }> {
    const roots = [...new Set(dto.ids.map((id) => id.trim()).filter(Boolean))];
    if (roots.length === 0) {
      throw new BadRequestException('هیچ دسته‌ای انتخاب نشده است');
    }

    if (!dto.isActive) {
      const subtreeIds = await this.collectSubtreeIdsRootFirst(roots);
      const result = await this.prisma.category.updateMany({
        where: { id: { in: subtreeIds } },
        data: { isActive: false },
      });
      await this.invalidateCategoryCaches();
      return { affected: result.count, isActive: false };
    }

    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true, isActive: true, title: true },
    });
    const byId = new Map(all.map((c) => [c.id, c]));
    for (const id of roots) {
      if (!byId.has(id)) {
        throw new NotFoundException(`دسته‌بندی یافت نشد: ${id}`);
      }
    }

    const selected = new Set(roots);
    const depthOf = (id: string): number => {
      let d = 0;
      let cur = byId.get(id);
      while (cur?.parentId) {
        d += 1;
        cur = byId.get(cur.parentId);
        if (d > 50) break;
      }
      return d;
    };
    const ordered = [...selected].sort((a, b) => depthOf(a) - depthOf(b));

    const activating = new Set<string>();
    const blocked: string[] = [];
    for (const id of ordered) {
      const node = byId.get(id)!;
      if (node.parentId) {
        const parent = byId.get(node.parentId);
        const parentOk =
          parent && (parent.isActive || activating.has(parent.id));
        if (!parentOk) {
          blocked.push(node.title);
          continue;
        }
      }
      activating.add(id);
    }

    if (activating.size === 0) {
      throw new BadRequestException(
        blocked.length
          ? `امکان فعال‌سازی نیست؛ والد این دسته‌ها غیرفعال است: ${blocked.slice(0, 5).join('، ')}`
          : 'هیچ دسته‌ای برای فعال‌سازی معتبر نیست',
      );
    }

    const result = await this.prisma.category.updateMany({
      where: { id: { in: [...activating] } },
      data: { isActive: true },
    });
    await this.invalidateCategoryCaches();
    return { affected: result.count, isActive: true };
  }

  async bulkUpdateFees(
    dto: BulkUpdateCategoryFeesDto,
  ): Promise<{ affected: number; ids: string[] }> {
    const existing = await this.prisma.category.findUnique({
      where: { id: dto.rootId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('دسته‌بندی یافت نشد');

    const includeDescendants = dto.includeDescendants !== false;
    const ids = includeDescendants
      ? await this.collectSubtreeIdsRootFirst([dto.rootId])
      : [dto.rootId];

    const feeData = this.buildFeeUpdateData(dto);
    if (Object.keys(feeData).length === 0) {
      throw new BadRequestException('هیچ فیلد کارمزدی برای به‌روزرسانی ارسال نشده');
    }

    const result = await this.prisma.category.updateMany({
      where: { id: { in: ids } },
      data: feeData,
    });
    await this.invalidateCategoryCaches();
    return { affected: result.count, ids };
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<AdminCategoryItem> {
    const existing = await this.prisma.category.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('دسته‌بندی یافت نشد');
    if (dto.slug && dto.slug !== existing.slug) {
      await this.ensureSlugUnique(dto.slug);
    }
    if (dto.parentId !== undefined && dto.parentId) {
      if (dto.parentId === id) {
        throw new BadRequestException('والد یک دسته نمی‌تواند خودش باشد');
      }
      await this.ensureParentExists(dto.parentId);
    }

    const feeData = this.buildFeeUpdateData(dto);
    const applyFeesToDescendants = Boolean(dto.applyFeesToDescendants);

    const updated = await this.prisma.category.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        slug: dto.slug ?? undefined,
        icon: dto.icon === undefined ? undefined : dto.icon,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        ...feeData,
        isActive: dto.isActive ?? undefined,
      },
      select: CATEGORY_SELECT,
    });

    if (applyFeesToDescendants && Object.keys(feeData).length > 0) {
      const subtreeIds = await this.collectSubtreeIdsRootFirst([id]);
      const descendantIds = subtreeIds.filter((x) => x !== id);
      if (descendantIds.length > 0) {
        await this.prisma.category.updateMany({
          where: { id: { in: descendantIds } },
          data: feeData,
        });
      }
    }

    await this.invalidateCategoryCaches();
    return updated;
  }

  /** Build Prisma fee update payload from DTO (only provided fields). */
  private buildFeeUpdateData(
    dto: Partial<BulkUpdateCategoryFeesDto | UpdateCategoryDto>,
  ): Prisma.CategoryUpdateManyMutationInput {
    const data: Prisma.CategoryUpdateManyMutationInput = {};

    if (dto.feePercentage !== undefined) data.feePercentage = dto.feePercentage;
    if (dto.feeCap !== undefined) data.feeCap = dto.feeCap;
    if (dto.feeCapDirect !== undefined) data.feeCapDirect = dto.feeCapDirect;
    if (dto.feeCapAuction !== undefined) data.feeCapAuction = dto.feeCapAuction;
    if (dto.feePercentageDirectNew !== undefined) {
      data.feePercentageDirectNew = dto.feePercentageDirectNew;
    }
    if (dto.feePercentageDirectUsed !== undefined) {
      data.feePercentageDirectUsed = dto.feePercentageDirectUsed;
    }
    if (dto.feePercentageAuctionNew !== undefined) {
      data.feePercentageAuctionNew = dto.feePercentageAuctionNew;
    }
    if (dto.feePercentageAuctionUsed !== undefined) {
      data.feePercentageAuctionUsed = dto.feePercentageAuctionUsed;
    }
    if (dto.auctionDepositPercentNew !== undefined) {
      data.auctionDepositPercentNew = dto.auctionDepositPercentNew;
    }
    if (dto.auctionDepositPercentUsed !== undefined) {
      data.auctionDepositPercentUsed = dto.auctionDepositPercentUsed;
    }

    // Keep legacy single fields in sync with New when New is updated
    const directLegacy =
      dto.feePercentageDirectNew ?? dto.feePercentageDirect;
    if (directLegacy !== undefined) data.feePercentageDirect = directLegacy;
    const auctionLegacy =
      dto.feePercentageAuctionNew ?? dto.feePercentageAuction;
    if (auctionLegacy !== undefined) data.feePercentageAuction = auctionLegacy;
    const depositLegacy =
      dto.auctionDepositPercentNew ?? dto.auctionDepositPercent;
    if (depositLegacy !== undefined) data.auctionDepositPercent = depositLegacy;

    return data;
  }

  async forceRemove(id: string): Promise<CategoryForceDeleteResult> {
    return this.forceRemoveMany([id]);
  }

  async forceRemoveMany(ids: string[]): Promise<CategoryForceDeleteResult> {
    const roots = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (roots.length === 0) {
      return { categories: 0, listings: 0, details: {} };
    }

    const orderedCategoryIds = await this.collectSubtreeIdsLeafFirst(roots);
    const totals: Record<string, number> = {};
    let listingsDeleted = 0;

    const result = await this.prisma.$transaction(
      async (tx) => {
        for (const categoryId of orderedCategoryIds) {
          const listingRows = await tx.listing.findMany({
            where: { categoryId },
            select: { id: true },
          });
          const listingIds = listingRows.map((l) => l.id);
          if (listingIds.length > 0) {
            const listingDetails = await this.listingDelete.deleteListingsTx(
              tx,
              listingIds,
            );
            listingsDeleted += listingDetails.listings ?? 0;
            for (const [k, v] of Object.entries(listingDetails)) {
              totals[k] = (totals[k] ?? 0) + v;
            }
          }

          totals.feeRules =
            (totals.feeRules ?? 0) +
            (await tx.feeRule.deleteMany({ where: { categoryId } })).count;

          totals.categories = (totals.categories ?? 0) + 1;
          await tx.category.delete({ where: { id: categoryId } });
        }

        return {
          categories: totals.categories ?? 0,
          listings: listingsDeleted,
          details: totals,
        };
      },
      { timeout: 120_000 },
    );
    await this.invalidateCategoryCaches();
    return result;
  }

  async remove(id: string): Promise<{ id: string }> {
    const counts = await this.prisma.category.findUnique({
      where: { id },
      select: { _count: { select: { listings: true, children: true } } },
    });
    if (!counts) throw new NotFoundException('دسته‌بندی یافت نشد');
    if (counts._count.listings > 0) {
      throw new ConflictException('این دسته دارای آگهی است و قابل حذف نیست');
    }
    if (counts._count.children > 0) {
      throw new ConflictException('ابتدا زیردسته‌ها را حذف کنید');
    }
    await this.prisma.category.delete({ where: { id } });
    await this.invalidateCategoryCaches();
    return { id };
  }

  private async invalidateCategoryCaches(): Promise<void> {
    await Promise.all([
      this.categoryTree.invalidate(),
      this.cache.delete('common:categories'),
      this.cache.deleteByPrefix('listings:home-feed'),
    ]);
  }

  /** خود ریشه و تمام زیردسته‌ها (والد قبل از فرزند) */
  private async collectSubtreeIdsRootFirst(
    rootIds: string[],
  ): Promise<string[]> {
    const leafFirst = await this.collectSubtreeIdsLeafFirst(rootIds);
    return leafFirst.reverse();
  }

  /** زیردسته‌ها قبل از والد (برای حذف امن FK) */
  private async collectSubtreeIdsLeafFirst(
    rootIds: string[],
  ): Promise<string[]> {
    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const byParent = new Map<string | null, string[]>();
    for (const c of all) {
      const key = c.parentId ?? null;
      const arr = byParent.get(key) ?? [];
      arr.push(c.id);
      byParent.set(key, arr);
    }

    const selected = new Set<string>();
    const walk = (id: string) => {
      if (selected.has(id)) return;
      selected.add(id);
      for (const childId of byParent.get(id) ?? []) {
        walk(childId);
      }
    };
    for (const id of rootIds) walk(id);

    const depthCache = new Map<string, number>();
    const depth = (id: string): number => {
      const cached = depthCache.get(id);
      if (cached !== undefined) return cached;
      const node = all.find((c) => c.id === id);
      if (!node?.parentId || !selected.has(node.parentId)) {
        depthCache.set(id, 0);
        return 0;
      }
      const d = 1 + depth(node.parentId);
      depthCache.set(id, d);
      return d;
    };

    return [...selected].sort((a, b) => depth(b) - depth(a));
  }

  private async ensureSlugUnique(slug: string): Promise<void> {
    const exists = await this.prisma.category.findUnique({ where: { slug } });
    if (exists) throw new ConflictException('این slug قبلا استفاده شده است');
  }

  private async ensureParentExists(parentId: string): Promise<void> {
    const parent = await this.prisma.category.findUnique({
      where: { id: parentId },
    });
    if (!parent) throw new BadRequestException('والد انتخاب‌شده یافت نشد');
  }
}
