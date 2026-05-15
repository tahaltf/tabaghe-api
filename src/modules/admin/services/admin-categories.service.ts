import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateCategoryDto,
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
  createdAt: true,
  parent: { select: { id: true, title: true } },
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
    const feeDirect = dto.feePercentageDirect ?? dto.feePercentage ?? 5;
    const feeAuction = dto.feePercentageAuction ?? dto.feePercentage ?? 5;
    const capDirect = dto.feeCapDirect ?? dto.feeCap ?? 500000;
    const capAuction = dto.feeCapAuction ?? dto.feeCap ?? 500000;
    return this.prisma.category.create({
      data: {
        title: dto.title,
        slug: dto.slug,
        icon: dto.icon ?? null,
        parentId: dto.parentId ?? null,
        feePercentage: dto.feePercentage ?? feeDirect,
        feeCap: dto.feeCap ?? capDirect,
        feePercentageDirect: feeDirect,
        feeCapDirect: capDirect,
        feePercentageAuction: feeAuction,
        feeCapAuction: capAuction,
        auctionDepositPercent: dto.auctionDepositPercent ?? 10,
      },
      select: CATEGORY_SELECT,
    });
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
    return this.prisma.category.update({
      where: { id },
      data: {
        title: dto.title ?? undefined,
        slug: dto.slug ?? undefined,
        icon: dto.icon === undefined ? undefined : dto.icon,
        parentId: dto.parentId === undefined ? undefined : dto.parentId,
        feePercentage: dto.feePercentage ?? undefined,
        feeCap: dto.feeCap ?? undefined,
        feePercentageDirect: dto.feePercentageDirect ?? undefined,
        feeCapDirect: dto.feeCapDirect ?? undefined,
        feePercentageAuction: dto.feePercentageAuction ?? undefined,
        feeCapAuction: dto.feeCapAuction ?? undefined,
        auctionDepositPercent: dto.auctionDepositPercent ?? undefined,
      },
      select: CATEGORY_SELECT,
    });
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

    return this.prisma.$transaction(
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
    return { id };
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
