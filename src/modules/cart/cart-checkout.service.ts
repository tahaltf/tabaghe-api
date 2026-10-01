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
      gateway: dto.gateway,
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

    const items: MarketplaceCheckoutLine[] = [];
    for (const ci of cartItems) {
      const line = await this.marketplaceCheckout.buildLineFromListing(
        ci.listingId,
        ci.quantity,
      );
      items.push(line);
    }

    return { cart: { sellerId: cart.sellerId }, items };
  }
}
