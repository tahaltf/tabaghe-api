import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponScopeMode, ListingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

export type CartCouponItem = {
  listingId: string;
  quantity: number;
  unitPrice: number;
  categoryId: string;
  /** صاحب آگهی — برای اعمال کوپن فروشنده الزامی است */
  sellerId?: string;
  onSale?: boolean;
};

const sellerSelect = {
  id: true,
  firstName: true,
  lastName: true,
  displayName: true,
  phone: true,
} as const;

@Injectable()
export class CouponsService {
  constructor(private readonly prisma: PrismaService) {}

  async validateForCart(
    userId: string,
    code: string,
    items: CartCouponItem[],
  ) {
    const coupon = await this.findActiveCoupon(code);
    await this.assertUserEligible(coupon, userId);
    await this.assertUsageLimits(coupon, userId);

    const categoryMatchSet = await this.buildCategoryMatchSet(coupon.categoryIds);

    const eligibleSubtotal = items.reduce((sum, item) => {
      if (!this.isItemEligible(coupon, item, categoryMatchSet)) return sum;
      return sum + item.unitPrice * item.quantity;
    }, 0);

    if (eligibleSubtotal <= 0) {
      throw new BadRequestException(
        'این کد برای محصولات سبد شما قابل استفاده نیست',
      );
    }

    const subtotal = items.reduce(
      (s, i) => s + i.unitPrice * i.quantity,
      0,
    );
    if (
      coupon.minOrderAmount != null &&
      subtotal < Number(coupon.minOrderAmount)
    ) {
      throw new BadRequestException(
        `حداقل مبلغ خرید برای این کد ${Number(coupon.minOrderAmount).toLocaleString('fa-IR')} تومان است`,
      );
    }

    const discountAmount = this.computeDiscount(
      coupon,
      eligibleSubtotal,
    );
    return { couponId: coupon.id, discountAmount, eligibleSubtotal };
  }

  async validateForSingleOrder(
    userId: string,
    code: string,
    listingId: string,
    quantity = 1,
  ) {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { direct: true },
    });
    if (!listing?.direct) {
      throw new NotFoundException('آگهی یافت نشد');
    }
    const unitPrice = Number(
      listing.direct.salePrice && Number(listing.direct.salePrice) > 0
        ? listing.direct.salePrice
        : listing.direct.price,
    );
    return this.validateForCart(userId, code, [
      {
        listingId,
        quantity,
        unitPrice,
        categoryId: listing.categoryId,
        sellerId: listing.authorId,
        onSale:
          listing.direct.salePrice != null &&
          Number(listing.direct.salePrice) > 0,
      },
    ]);
  }

  async listAdmin(sellerId?: string) {
    return this.prisma.coupon.findMany({
      where: sellerId ? { sellerId } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { seller: { select: sellerSelect } },
    });
  }

  async createAdmin(dto: CreateCouponDto) {
    if (dto.sellerId) {
      await this.assertSellerExists(dto.sellerId);
      await this.assertSellerOwnedScope(dto.sellerId, dto);
    }
    return this.prisma.coupon.create({
      data: this.toCreateData(dto, dto.sellerId ?? null),
      include: { seller: { select: sellerSelect } },
    });
  }

  async updateAdmin(id: string, dto: UpdateCouponDto) {
    const existing = await this.prisma.coupon.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('کد تخفیف یافت نشد');

    const nextSellerId =
      dto.sellerId !== undefined ? dto.sellerId : existing.sellerId;
    if (nextSellerId) {
      await this.assertSellerExists(nextSellerId);
      await this.assertSellerOwnedScope(nextSellerId, {
        categoryIds: dto.categoryIds ?? existing.categoryIds,
        listingIds: dto.listingIds ?? existing.listingIds,
        excludedListingIds:
          dto.excludedListingIds ?? existing.excludedListingIds,
      });
    }

    return this.prisma.coupon.update({
      where: { id },
      data: this.toUpdateData(dto, true),
      include: { seller: { select: sellerSelect } },
    });
  }

  async deleteAdmin(id: string) {
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  async listForSeller(sellerId: string) {
    return this.prisma.coupon.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async createForSeller(sellerId: string, dto: CreateCouponDto) {
    await this.assertSellerOwnedScope(sellerId, dto);
    const data = this.normalizeSellerScope(dto);
    return this.prisma.coupon.create({
      data: this.toCreateData(
        { ...dto, ...data, userIds: [] },
        sellerId,
      ),
    });
  }

  async updateForSeller(
    sellerId: string,
    id: string,
    dto: UpdateCouponDto,
  ) {
    const existing = await this.requireSellerCoupon(sellerId, id);
    const merged = {
      categoryIds: dto.categoryIds ?? existing.categoryIds,
      listingIds: dto.listingIds ?? existing.listingIds,
      excludedListingIds:
        dto.excludedListingIds ?? existing.excludedListingIds,
      scopeMode: dto.scopeMode ?? existing.scopeMode,
    };
    await this.assertSellerOwnedScope(sellerId, merged);
    const data = this.normalizeSellerScope({ ...dto, ...merged });
    return this.prisma.coupon.update({
      where: { id },
      data: this.toUpdateData(
        { ...dto, ...data, userIds: [], sellerId: undefined },
        false,
      ),
    });
  }

  async deleteForSeller(sellerId: string, id: string) {
    await this.requireSellerCoupon(sellerId, id);
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
  }

  /** دسته‌ها و آگهی‌های فروشنده برای فرم محدوده اعمال */
  async getSellerScopeOptions(sellerId: string) {
    const listings = await this.prisma.listing.findMany({
      where: {
        authorId: sellerId,
        deletedAt: null,
        status: ListingStatus.APPROVED,
      },
      select: {
        id: true,
        title: true,
        categoryId: true,
        category: { select: { id: true, title: true, slug: true } },
        thumbnail: true,
        status: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const categoryMap = new Map<
      string,
      { id: string; title: string; slug: string }
    >();
    for (const listing of listings) {
      if (listing.category) {
        categoryMap.set(listing.category.id, listing.category);
      }
    }

    return {
      categories: Array.from(categoryMap.values()),
      listings: listings.map((l) => ({
        id: l.id,
        title: l.title,
        categoryId: l.categoryId,
        thumbnail: l.thumbnail,
        status: l.status,
      })),
    };
  }

  private async requireSellerCoupon(sellerId: string, id: string) {
    const coupon = await this.prisma.coupon.findUnique({ where: { id } });
    if (!coupon || coupon.sellerId !== sellerId) {
      throw new NotFoundException('کد تخفیف یافت نشد');
    }
    return coupon;
  }

  private async assertSellerExists(sellerId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: sellerId },
      select: { id: true },
    });
    if (!user) throw new BadRequestException('فروشنده یافت نشد');
  }

  private async assertSellerOwnedScope(
    sellerId: string,
    scope: {
      categoryIds?: string[];
      listingIds?: string[];
      excludedListingIds?: string[];
    },
  ) {
    const listingIds = [
      ...(scope.listingIds ?? []),
      ...(scope.excludedListingIds ?? []),
    ];
    if (listingIds.length) {
      const owned = await this.prisma.listing.findMany({
        where: {
          id: { in: listingIds },
          authorId: sellerId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (owned.length !== new Set(listingIds).size) {
        throw new ForbiddenException(
          'فقط می‌توانید محصولات خودتان را در محدوده کد انتخاب کنید',
        );
      }
    }

    const categoryIds = scope.categoryIds ?? [];
    if (categoryIds.length) {
      const cats = await this.prisma.listing.findMany({
        where: {
          authorId: sellerId,
          deletedAt: null,
          categoryId: { in: categoryIds },
        },
        select: { categoryId: true },
        distinct: ['categoryId'],
      });
      const ownedCats = new Set(cats.map((c) => c.categoryId));
      if (categoryIds.some((id) => !ownedCats.has(id))) {
        throw new ForbiddenException(
          'فقط دسته‌هایی که محصول دارید قابل انتخاب هستند',
        );
      }
    }
  }

  /**
   * فروشنده: اگر دسته انتخاب شده → INCLUDE؛ وگرنه ALL.
   * listingIds فقط برای ادمین معنا دارد؛ در پنل فروشنده خالی می‌ماند
   * و مستثنی‌ها در excludedListingIds می‌روند.
   */
  private normalizeSellerScope(dto: {
    categoryIds?: string[];
    listingIds?: string[];
    excludedListingIds?: string[];
    scopeMode?: CouponScopeMode;
  }) {
    const categoryIds = dto.categoryIds ?? [];
    return {
      scopeMode:
        categoryIds.length > 0 ? CouponScopeMode.INCLUDE : CouponScopeMode.ALL,
      categoryIds,
      listingIds: [] as string[],
      excludedListingIds: dto.excludedListingIds ?? [],
    };
  }

  private async findActiveCoupon(code: string) {
    const coupon = await this.prisma.coupon.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!coupon || !coupon.isActive) {
      throw new BadRequestException('کد تخفیف نامعتبر است');
    }
    const now = new Date();
    if (coupon.startsAt && coupon.startsAt > now) {
      throw new BadRequestException('این کد هنوز فعال نشده است');
    }
    if (coupon.expiresAt && coupon.expiresAt < now) {
      throw new BadRequestException('مهلت استفاده از این کد به پایان رسیده است');
    }
    return coupon;
  }

  private async assertUserEligible(
    coupon: { userIds: string[] },
    userId: string,
  ) {
    if (coupon.userIds.length > 0 && !coupon.userIds.includes(userId)) {
      throw new BadRequestException('این کد برای حساب شما فعال نیست');
    }
  }

  private async assertUsageLimits(
    coupon: {
      id: string;
      maxUsesTotal: number | null;
      maxUsesPerUser: number | null;
      usedCount: number;
    },
    userId: string,
  ) {
    if (coupon.maxUsesTotal != null && coupon.usedCount >= coupon.maxUsesTotal) {
      throw new BadRequestException('سقف استفاده از این کد پر شده است');
    }
    if (coupon.maxUsesPerUser != null) {
      const userUses = await this.prisma.couponRedemption.count({
        where: { couponId: coupon.id, userId },
      });
      if (userUses >= coupon.maxUsesPerUser) {
        throw new BadRequestException(
          'شما قبلاً حداکثر دفعات مجاز از این کد استفاده کرده‌اید',
        );
      }
    }
  }

  private isItemEligible(
    coupon: {
      sellerId: string | null;
      allowOnSaleItems: boolean;
      scopeMode: CouponScopeMode;
      categoryIds: string[];
      listingIds: string[];
      excludedListingIds: string[];
    },
    item: CartCouponItem,
    categoryMatchSet?: Set<string>,
  ): boolean {
    if (coupon.sellerId) {
      if (!item.sellerId || item.sellerId !== coupon.sellerId) return false;
    }
    if (coupon.excludedListingIds.includes(item.listingId)) return false;
    if (!coupon.allowOnSaleItems && item.onSale) return false;
    if (coupon.scopeMode === CouponScopeMode.ALL) return true;
    const cats = categoryMatchSet ?? new Set(coupon.categoryIds);
    const inCategories = cats.has(item.categoryId);
    const inListings = coupon.listingIds.includes(item.listingId);
    if (coupon.scopeMode === CouponScopeMode.INCLUDE) {
      return inCategories || inListings;
    }
    return !inCategories && !inListings;
  }

  /**
   * اگر دسته والد انتخاب شده باشد، زیردسته‌ها هم match شوند.
   */
  private async buildCategoryMatchSet(categoryIds: string[]): Promise<Set<string>> {
    const set = new Set(categoryIds);
    if (!categoryIds.length) return set;

    const all = await this.prisma.category.findMany({
      select: { id: true, parentId: true },
    });
    const childrenByParent = new Map<string, string[]>();
    for (const cat of all) {
      if (!cat.parentId) continue;
      const list = childrenByParent.get(cat.parentId) ?? [];
      list.push(cat.id);
      childrenByParent.set(cat.parentId, list);
    }

    const queue = [...categoryIds];
    while (queue.length) {
      const id = queue.shift()!;
      for (const child of childrenByParent.get(id) ?? []) {
        if (set.has(child)) continue;
        set.add(child);
        queue.push(child);
      }
    }
    return set;
  }

  private computeDiscount(
    coupon: {
      discountType: string;
      discountValue: Prisma.Decimal;
      maxDiscountAmount: Prisma.Decimal | null;
    },
    eligibleSubtotal: number,
  ): number {
    let discount = 0;
    if (coupon.discountType === 'FIXED') {
      discount = Number(coupon.discountValue);
    } else {
      discount = (eligibleSubtotal * Number(coupon.discountValue)) / 100;
      if (
        coupon.maxDiscountAmount != null &&
        discount > Number(coupon.maxDiscountAmount)
      ) {
        discount = Number(coupon.maxDiscountAmount);
      }
    }
    return Math.min(Math.max(0, Math.floor(discount)), eligibleSubtotal);
  }

  private toUpdateData(
    dto: UpdateCouponDto,
    allowSellerId: boolean,
  ): Prisma.CouponUpdateInput {
    const data: Prisma.CouponUpdateInput = {};
    if (dto.code !== undefined) data.code = dto.code.trim().toUpperCase();
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.startsAt !== undefined) {
      data.startsAt = dto.startsAt ? new Date(dto.startsAt) : null;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    }
    if (dto.discountType !== undefined) data.discountType = dto.discountType;
    if (dto.discountValue !== undefined) data.discountValue = dto.discountValue;
    if (dto.maxDiscountAmount !== undefined) {
      data.maxDiscountAmount = dto.maxDiscountAmount;
    }
    if (dto.minOrderAmount !== undefined) data.minOrderAmount = dto.minOrderAmount;
    if (dto.maxUsesTotal !== undefined) data.maxUsesTotal = dto.maxUsesTotal;
    if (dto.maxUsesPerUser !== undefined) data.maxUsesPerUser = dto.maxUsesPerUser;
    if (dto.allowOnSaleItems !== undefined) {
      data.allowOnSaleItems = dto.allowOnSaleItems;
    }
    if (dto.scopeMode !== undefined) data.scopeMode = dto.scopeMode;
    if (dto.categoryIds !== undefined) data.categoryIds = dto.categoryIds;
    if (dto.listingIds !== undefined) data.listingIds = dto.listingIds;
    if (dto.excludedListingIds !== undefined) {
      data.excludedListingIds = dto.excludedListingIds;
    }
    if (dto.userIds !== undefined) data.userIds = dto.userIds;
    if (allowSellerId && dto.sellerId !== undefined) {
      data.seller = dto.sellerId
        ? { connect: { id: dto.sellerId } }
        : { disconnect: true };
    }
    return data;
  }

  private toCreateData(
    dto: CreateCouponDto,
    sellerId: string | null,
  ): Prisma.CouponCreateInput {
    return {
      code: dto.code.trim().toUpperCase(),
      isActive: dto.isActive ?? true,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      discountType: dto.discountType,
      discountValue: dto.discountValue,
      maxDiscountAmount: dto.maxDiscountAmount ?? null,
      minOrderAmount: dto.minOrderAmount ?? null,
      maxUsesTotal: dto.maxUsesTotal ?? null,
      maxUsesPerUser: dto.maxUsesPerUser ?? null,
      allowOnSaleItems: dto.allowOnSaleItems ?? true,
      scopeMode: dto.scopeMode ?? CouponScopeMode.ALL,
      categoryIds: dto.categoryIds ?? [],
      listingIds: dto.listingIds ?? [],
      excludedListingIds: dto.excludedListingIds ?? [],
      userIds: dto.userIds ?? [],
      ...(sellerId
        ? { seller: { connect: { id: sellerId } } }
        : {}),
    };
  }
}
