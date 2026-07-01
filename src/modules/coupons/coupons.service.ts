import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CouponScopeMode, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

export type CartCouponItem = {
  listingId: string;
  quantity: number;
  unitPrice: number;
  categoryId: string;
  onSale?: boolean;
};

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

    const eligibleSubtotal = items.reduce((sum, item) => {
      if (!this.isItemEligible(coupon, item)) return sum;
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
        onSale:
          listing.direct.salePrice != null &&
          Number(listing.direct.salePrice) > 0,
      },
    ]);
  }

  async listAdmin() {
    return this.prisma.coupon.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async createAdmin(dto: CreateCouponDto) {
    return this.prisma.coupon.create({
      data: this.toCreateData(dto),
    });
  }

  async updateAdmin(id: string, dto: UpdateCouponDto) {
    return this.prisma.coupon.update({
      where: { id },
      data: this.toUpdateData(dto),
    });
  }

  async deleteAdmin(id: string) {
    await this.prisma.coupon.delete({ where: { id } });
    return { ok: true };
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
    coupon: { id: string; maxUsesTotal: number | null; maxUsesPerUser: number | null; usedCount: number },
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
      allowOnSaleItems: boolean;
      scopeMode: CouponScopeMode;
      categoryIds: string[];
      listingIds: string[];
    },
    item: CartCouponItem,
  ): boolean {
    if (!coupon.allowOnSaleItems && item.onSale) return false;
    if (coupon.scopeMode === CouponScopeMode.ALL) return true;
    const inCategories = coupon.categoryIds.includes(item.categoryId);
    const inListings = coupon.listingIds.includes(item.listingId);
    if (coupon.scopeMode === CouponScopeMode.INCLUDE) {
      return inCategories || inListings;
    }
    return !inCategories && !inListings;
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

  private toUpdateData(dto: UpdateCouponDto): Prisma.CouponUpdateInput {
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
    if (dto.userIds !== undefined) data.userIds = dto.userIds;
    return data;
  }

  private toCreateData(dto: CreateCouponDto): Prisma.CouponCreateInput {
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
      userIds: dto.userIds ?? [],
    };
  }
}
