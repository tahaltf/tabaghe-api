import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { CheckoutSessionSource } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CartService } from './cart.service';
import { CartCheckoutDto, CartCheckoutPreviewDto } from './dto/cart.dto';
import {
  MarketplaceCheckoutLine,
  MarketplaceCheckoutService,
} from './marketplace-checkout.service';
import type { ClientRequestMeta } from '../../common/http/client-ip.util';

@Injectable()
export class CartCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly marketplaceCheckout: MarketplaceCheckoutService,
  ) {}

  async preview(userId: string, dto: CartCheckoutPreviewDto) {
    const { cart, items } = await this.loadCartLines(userId);
    const preview = await this.marketplaceCheckout.previewFromLines(
      userId,
      items,
      {
        couponCode: dto.couponCode,
        requiresVerification: dto.requiresVerification,
      },
    );
    return {
      sellerId: cart.sellerId,
      ...preview,
    };
  }

  async checkout(
    userId: string,
    dto: CartCheckoutDto,
    clientMeta?: ClientRequestMeta,
  ) {
    const { items } = await this.loadCartLines(userId);
    if (items.length === 0) {
      throw new BadRequestException('سبد خرید خالی است');
    }

    const result = await this.marketplaceCheckout.checkoutLines(userId, {
      source: CheckoutSessionSource.CART,
      addressId: dto.addressId,
      paymentMethod: dto.paymentMethod,
      couponCode: dto.couponCode,
      requiresVerification: dto.requiresVerification,
      clearCart: true,
      items,
      clientMeta,
    });

    return {
      sessionId: result.sessionId,
      orderIds: result.orderIds,
      totalAmount: result.totalAmount,
      discountAmount: result.discountAmount,
      paymentUrl: result.paymentUrl,
    };
  }

  private async loadCartLines(userId: string): Promise<{
    cart: { sellerId: string };
    items: MarketplaceCheckoutLine[];
  }> {
    const { cart, items: cartItems } =
      await this.cartService.requireCartItems(userId);
    const listingIds = cartItems.map((i) => i.listingId);
    const listings = await this.prisma.listing.findMany({
      where: { id: { in: listingIds } },
      include: { direct: true, category: true },
    });
    const listingMap = new Map(listings.map((l) => [l.id, l]));
    const shippingDefault = await this.readShippingCost();

    const items = cartItems.map((ci) => {
      const listing = listingMap.get(ci.listingId);
      if (!listing?.direct) {
        throw new BadRequestException('آگهی نامعتبر در سبد');
      }
      const unitPrice = Number(
        listing.direct.salePrice && Number(listing.direct.salePrice) > 0
          ? listing.direct.salePrice
          : listing.direct.price,
      );
      const lineTotal = unitPrice * ci.quantity;
      const shippingCost =
        listing.shippingPayer === 'BUYER_PREPAID'
          ? listing.shippingCostOverride != null &&
            listing.shippingCostOverride >= 0
            ? listing.shippingCostOverride
            : shippingDefault
          : 0;
      return {
        listingId: ci.listingId,
        quantity: ci.quantity,
        unitPrice,
        lineTotal,
        shippingCost,
        categoryId: listing.categoryId,
        onSale:
          listing.direct.salePrice != null &&
          Number(listing.direct.salePrice) > 0,
      };
    });

    return { cart: { sellerId: cart.sellerId }, items };
  }

  private async readShippingCost(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SHIPPING_COST' },
    });
    return Number(row?.value ?? 0);
  }
}
