import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { CheckoutSessionStatus, OrderType, Prisma } from '@prisma/client';
import Decimal from 'decimal.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrdersCheckoutService } from '../orders/services/command/orders-checkout.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { CartService } from './cart.service';
import { CartCheckoutDto, CartCheckoutPreviewDto } from './dto/cart.dto';

@Injectable()
export class CartCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cartService: CartService,
    private readonly ordersCheckout: OrdersCheckoutService,
    private readonly couponsService: CouponsService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async preview(userId: string, dto: CartCheckoutPreviewDto) {
    const { cart, items, subtotal } = await this.loadCartPricing(userId);
    let discountAmount = 0;
    let couponId: string | null = null;
    if (dto.couponCode?.trim()) {
      const validated = await this.couponsService.validateForCart(
        userId,
        dto.couponCode.trim(),
        items,
      );
      discountAmount = validated.discountAmount;
      couponId = validated.couponId;
    }
    const shippingTotal = items.reduce((s, i) => s + i.shippingCost, 0);
    const verificationFee = dto.requiresVerification
      ? await this.readVerificationFee()
      : 0;
    const goodsTotal = subtotal;
    const totalBeforeDiscount = goodsTotal + shippingTotal + verificationFee;
    const totalPayable = Math.max(0, totalBeforeDiscount - discountAmount);
    return {
      sellerId: cart.sellerId,
      items,
      subtotal: goodsTotal,
      shippingTotal,
      verificationFee,
      discountAmount,
      couponId,
      totalPayable,
    };
  }

  async checkout(userId: string, dto: CartCheckoutDto) {
    const preview = await this.preview(userId, dto);
    if (preview.items.length === 0) {
      throw new BadRequestException('سبد خرید خالی است');
    }

    const createdOrders: { id: string; totalAmount: number }[] = [];
    for (const item of preview.items) {
      const order = await this.ordersCheckout.handleUniversalOrder(userId, {
        listingId: item.listingId,
        quantity: item.quantity,
        orderType: OrderType.DIRECT,
        paymentMethod: dto.paymentMethod,
        addressId: dto.addressId,
        requiresVerification: dto.requiresVerification ?? false,
        skipPaymentInit: true,
      });
      createdOrders.push({
        id: order.id,
        totalAmount: Number(order.totalAmount),
      });
    }

    const grossTotal = createdOrders.reduce((s, o) => s + o.totalAmount, 0);
    let remainingDiscount = preview.discountAmount;
    const adjustedOrders = createdOrders.map((o, index) => {
      const share =
        index === createdOrders.length - 1
          ? remainingDiscount
          : grossTotal > 0
            ? Math.floor(
                (preview.discountAmount * o.totalAmount) / grossTotal,
              )
            : 0;
      remainingDiscount -= share;
      return { ...o, adjustedTotal: Math.max(0, o.totalAmount - share) };
    });

    const session = await this.prisma.$transaction(async (tx) => {
      for (const o of adjustedOrders) {
        if (o.adjustedTotal !== o.totalAmount) {
          await tx.order.update({
            where: { id: o.id },
            data: { totalAmount: o.adjustedTotal },
          });
        }
      }

      const sessionRow = await tx.checkoutSession.create({
        data: {
          buyerId: userId,
          totalAmount: preview.totalPayable,
          discountAmount: preview.discountAmount,
          couponId: preview.couponId,
          status: CheckoutSessionStatus.PENDING,
        },
      });

      await tx.order.updateMany({
        where: { id: { in: createdOrders.map((o) => o.id) } },
        data: { checkoutSessionId: sessionRow.id },
      });

      if (preview.couponId && preview.discountAmount > 0) {
        await tx.coupon.update({
          where: { id: preview.couponId },
          data: { usedCount: { increment: 1 } },
        });
        await tx.couponRedemption.create({
          data: {
            couponId: preview.couponId,
            userId,
            checkoutSessionId: sessionRow.id,
            amount: preview.discountAmount,
          },
        });
      }

      const cart = await tx.cart.findUnique({ where: { userId } });
      if (cart) {
        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.delete({ where: { id: cart.id } });
      }

      return sessionRow;
    });

    let paymentUrl: string | null = null;
    if (dto.paymentMethod === 'GATEWAY' && preview.totalPayable > 0) {
      const initiated = await this.paymentsService.initiateCheckoutSessionPayment(
        session.id,
        userId,
      );
      paymentUrl = initiated.paymentUrl;
    }

    return {
      sessionId: session.id,
      orderIds: createdOrders.map((o) => o.id),
      totalAmount: preview.totalPayable,
      discountAmount: preview.discountAmount,
      paymentUrl,
    };
  }

  private async loadCartPricing(userId: string) {
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

    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    return { cart, items, subtotal };
  }

  private async readVerificationFee(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'VERIFICATION_FEE' },
    });
    return Number(row?.value ?? 250000);
  }

  private async readShippingCost(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SHIPPING_COST' },
    });
    return Number(row?.value ?? 0);
  }
}
