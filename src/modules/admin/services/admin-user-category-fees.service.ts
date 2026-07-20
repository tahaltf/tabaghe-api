import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  UpsertUserCategoryFeesDto,
  UserCategoryFeeItemDto,
} from '../dto/admin-user-category-fees.dto';

export type UserCategoryFeeRow = {
  categoryId: string;
  title: string;
  parentId: string | null;
  depth: number;
  defaults: {
    feePercentageDirectNew: number;
    feePercentageDirectUsed: number;
    feePercentageAuctionNew: number;
    feePercentageAuctionUsed: number;
    auctionDepositPercentNew: number;
    auctionDepositPercentUsed: number;
  };
  override: {
    feePercentageDirectNew: number | null;
    feePercentageDirectUsed: number | null;
    feePercentageAuctionNew: number | null;
    feePercentageAuctionUsed: number | null;
    auctionDepositPercentNew: number | null;
    auctionDepositPercentUsed: number | null;
  } | null;
};

const FEE_KEYS = [
  'feePercentageDirectNew',
  'feePercentageDirectUsed',
  'feePercentageAuctionNew',
  'feePercentageAuctionUsed',
  'auctionDepositPercentNew',
  'auctionDepositPercentUsed',
] as const;

type FeeKey = (typeof FEE_KEYS)[number];

@Injectable()
export class AdminUserCategoryFeesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<UserCategoryFeeRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const categories = await this.prisma.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        title: true,
        parentId: true,
        feePercentageDirectNew: true,
        feePercentageDirectUsed: true,
        feePercentageAuctionNew: true,
        feePercentageAuctionUsed: true,
        auctionDepositPercentNew: true,
        auctionDepositPercentUsed: true,
        feePercentageDirect: true,
        feePercentageAuction: true,
        auctionDepositPercent: true,
      },
      orderBy: [{ parentId: 'asc' }, { title: 'asc' }],
    });

    const overrides = await this.prisma.userCategoryFee.findMany({
      where: { userId },
    });
    const overrideByCat = new Map(overrides.map((o) => [o.categoryId, o]));

    const depthMap = this.buildDepthMap(categories);
    const sorted = this.sortTreeOrder(categories);

    return sorted.map((c) => {
      const o = overrideByCat.get(c.id);
      return {
        categoryId: c.id,
        title: c.title,
        parentId: c.parentId,
        depth: depthMap.get(c.id) ?? 0,
        defaults: {
          feePercentageDirectNew:
            c.feePercentageDirectNew ?? c.feePercentageDirect ?? 5,
          feePercentageDirectUsed:
            c.feePercentageDirectUsed ?? c.feePercentageDirect ?? 5,
          feePercentageAuctionNew:
            c.feePercentageAuctionNew ?? c.feePercentageAuction ?? 5,
          feePercentageAuctionUsed:
            c.feePercentageAuctionUsed ?? c.feePercentageAuction ?? 5,
          auctionDepositPercentNew:
            c.auctionDepositPercentNew ?? c.auctionDepositPercent ?? 10,
          auctionDepositPercentUsed:
            c.auctionDepositPercentUsed ?? c.auctionDepositPercent ?? 10,
        },
        override: o
          ? {
              feePercentageDirectNew: o.feePercentageDirectNew,
              feePercentageDirectUsed: o.feePercentageDirectUsed,
              feePercentageAuctionNew: o.feePercentageAuctionNew,
              feePercentageAuctionUsed: o.feePercentageAuctionUsed,
              auctionDepositPercentNew: o.auctionDepositPercentNew,
              auctionDepositPercentUsed: o.auctionDepositPercentUsed,
            }
          : null,
      };
    });
  }

  async upsert(
    userId: string,
    dto: UpsertUserCategoryFeesDto,
  ): Promise<UserCategoryFeeRow[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('کاربر یافت نشد');

    const categoryIds = [...new Set(dto.items.map((i) => i.categoryId))];
    if (categoryIds.length) {
      const found = await this.prisma.category.findMany({
        where: { id: { in: categoryIds } },
        select: { id: true },
      });
      if (found.length !== categoryIds.length) {
        throw new NotFoundException('یک یا چند دسته یافت نشد');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of dto.items) {
        await this.upsertOne(tx, userId, item);
      }
    });

    return this.list(userId);
  }

  private async upsertOne(
    tx: Prisma.TransactionClient,
    userId: string,
    item: UserCategoryFeeItemDto,
  ): Promise<void> {
    const data: Record<FeeKey, number | null> = {
      feePercentageDirectNew: this.norm(item.feePercentageDirectNew),
      feePercentageDirectUsed: this.norm(item.feePercentageDirectUsed),
      feePercentageAuctionNew: this.norm(item.feePercentageAuctionNew),
      feePercentageAuctionUsed: this.norm(item.feePercentageAuctionUsed),
      auctionDepositPercentNew: this.norm(item.auctionDepositPercentNew),
      auctionDepositPercentUsed: this.norm(item.auctionDepositPercentUsed),
    };

    const allNull = FEE_KEYS.every((k) => data[k] == null);

    if (allNull) {
      await tx.userCategoryFee.deleteMany({
        where: { userId, categoryId: item.categoryId },
      });
      return;
    }

    await tx.userCategoryFee.upsert({
      where: {
        userId_categoryId: { userId, categoryId: item.categoryId },
      },
      create: {
        userId,
        categoryId: item.categoryId,
        ...data,
      },
      update: data,
    });
  }

  private norm(v: number | null | undefined): number | null {
    if (v === undefined || v === null) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return n;
  }

  private buildDepthMap(
    categories: { id: string; parentId: string | null }[],
  ): Map<string, number> {
    const byId = new Map(categories.map((c) => [c.id, c]));
    const depth = new Map<string, number>();
    const walk = (id: string): number => {
      if (depth.has(id)) return depth.get(id)!;
      const c = byId.get(id);
      if (!c || !c.parentId || !byId.has(c.parentId)) {
        depth.set(id, 0);
        return 0;
      }
      const d = walk(c.parentId) + 1;
      depth.set(id, d);
      return d;
    };
    categories.forEach((c) => walk(c.id));
    return depth;
  }

  private sortTreeOrder<
    T extends { id: string; parentId: string | null; title: string },
  >(list: T[]): T[] {
    const result: T[] = [];
    const ids = new Set(list.map((c) => c.id));
    const walk = (parentId: string | null) => {
      list
        .filter((c) =>
          parentId === null
            ? !c.parentId || !ids.has(c.parentId)
            : c.parentId === parentId,
        )
        .sort((a, b) => a.title.localeCompare(b.title, 'fa'))
        .forEach((c) => {
          result.push(c);
          walk(c.id);
        });
    };
    walk(null);
    return result;
  }
}
