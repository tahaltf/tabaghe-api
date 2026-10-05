import {
  BadRequestException,
  Inject,
  Injectable,
  forwardRef,
} from '@nestjs/common';
import {
  CheckoutSessionSource,
  CheckoutSessionStatus,
  OrderType,
  PaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrdersCheckoutService } from '../orders/services/command/orders-checkout.service';
import { CouponsService } from '../coupons/coupons.service';
import { PaymentsService } from '../payments/payments.service';
import { VerificationFeeCalculatorService } from '../fees/verification-fee-calculator.service';
import type { ClientRequestMeta } from '../../common/http/client-ip.util';
import { CurrencyService } from '../currency/currency.service';
import { BASE_CURRENCY_CODE } from '../currency/providers/fx-provider';
import { resolveListingEffectiveUnitPrice } from '../../common/listing/listing-price.util';

export type MarketplaceCheckoutLine = {
  listingId: string;
  variationId?: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  shippingCost: number;
  categoryId: string;
  sellerId?: string;
  onSale?: boolean;
};

export type MarketplaceCheckoutPreview = {
  items: MarketplaceCheckoutLine[];
  subtotal: number;
  shippingTotal: number;
  verificationFee: number;
  discountAmount: number;
  couponId: string | null;
  totalPayable: number;
};

export type MarketplaceCheckoutInput = {
  source: CheckoutSessionSource;
  addressId: string;
  paymentMethod: 'GATEWAY' | 'WALLET';
  gateway?: string;
  couponCode?: string;
  requiresVerification?: boolean;
  /** پاک کردن سبد بعد از ساخت session (فقط CART) */
  clearCart?: boolean;
  items: MarketplaceCheckoutLine[];
  clientMeta?: ClientRequestMeta;
};

@Injectable()
export class MarketplaceCheckoutService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => OrdersCheckoutService))
    private readonly ordersCheckout: OrdersCheckoutService,
    private readonly couponsService: CouponsService,
    private readonly paymentsService: PaymentsService,
    private readonly verificationFeeCalculator: VerificationFeeCalculatorService,
    private readonly currency: CurrencyService,
  ) {}

  async previewFromLines(
    userId: string,
    items: MarketplaceCheckoutLine[],
    opts: { couponCode?: string; requiresVerification?: boolean },
  ): Promise<MarketplaceCheckoutPreview> {
    if (items.length === 0) {
      throw new BadRequestException('هیچ کالایی برای تسویه وجود ندارد');
    }

    let discountAmount = 0;
    let couponId: string | null = null;
    if (opts.couponCode?.trim()) {
      const validated = await this.couponsService.validateForCart(
        userId,
        opts.couponCode.trim(),
        items,
      );
      discountAmount = validated.discountAmount;
      couponId = validated.couponId;
    }

    const shippingTotal = items.reduce((s, i) => s + i.shippingCost, 0);
    let verificationFee = 0;
    if (opts.requiresVerification) {
      const categoryIds = [
        ...new Set(items.map((i) => i.categoryId).filter(Boolean)),
      ];
      if (categoryIds.length) {
        const cats = await this.prisma.category.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, title: true, verificationEnabled: true },
        });
        const blocked = cats.find((c) => c.verificationEnabled === false);
        if (blocked) {
          throw new BadRequestException(
            `دسته «${blocked.title}» امکان کارشناسی ندارد.`,
          );
        }
      }
      for (const item of items) {
        verificationFee += await this.verificationFeeCalculator.resolve(
          item.categoryId,
          item.lineTotal,
        );
      }
    }
    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const totalBeforeDiscount = subtotal + shippingTotal + verificationFee;
    const totalPayable = Math.max(0, totalBeforeDiscount - discountAmount);

    return {
      items,
      subtotal,
      shippingTotal,
      verificationFee,
      discountAmount,
      couponId,
      totalPayable,
    };
  }

  async checkoutLines(userId: string, input: MarketplaceCheckoutInput) {
    const preview = await this.previewFromLines(userId, input.items, {
      couponCode: input.couponCode,
      requiresVerification: input.requiresVerification,
    });

    const requiresVerification = Boolean(input.requiresVerification);
    const sessionVerificationFee = requiresVerification
      ? preview.verificationFee
      : 0;

    const createdOrders: {
      id: string;
      totalAmount: number;
      platformFee: number;
      sellerRevenue: number;
      verificationFee: number;
    }[] = [];

    for (let i = 0; i < preview.items.length; i++) {
      const item = preview.items[i];
      const verificationFeeOverride =
        requiresVerification && i === 0 ? sessionVerificationFee : 0;

      const order = await this.ordersCheckout.handleUniversalOrder(userId, {
        listingId: item.listingId,
        variationId: item.variationId ?? undefined,
        quantity: item.quantity,
        orderType: OrderType.DIRECT,
        paymentMethod: input.paymentMethod,
        addressId: input.addressId,
        requiresVerification,
        deferSettlement: true,
        skipPaymentInit: true,
        skipCoupon: true,
        verificationFeeOverride,
      });

      createdOrders.push({
        id: order.id,
        totalAmount: Number(order.totalAmount),
        platformFee: Number(order.platformFee ?? 0),
        sellerRevenue: Number(order.sellerRevenue ?? 0),
        verificationFee: Number(order.verificationFee ?? 0),
      });
    }

    const grossTotal = createdOrders.reduce((s, o) => s + o.totalAmount, 0);
    let remainingDiscount = preview.discountAmount;
    const adjustedOrders = createdOrders.map((o, index) => {
      const share =
        index === createdOrders.length - 1
          ? remainingDiscount
          : grossTotal > 0
            ? Math.floor((preview.discountAmount * o.totalAmount) / grossTotal)
            : 0;
      remainingDiscount -= share;
      return { ...o, discountShare: share };
    });

    let session: { id: string };
    try {
      session = await this.prisma.$transaction(async (tx) => {
        for (const o of adjustedOrders) {
          if (o.discountShare <= 0) continue;
          const finance = this.applyDiscountToOrderFinance({
            totalAmount: o.totalAmount,
            platformFee: o.platformFee,
            sellerRevenue: o.sellerRevenue,
            verificationFee: o.verificationFee,
            discountShare: o.discountShare,
          });
          await tx.order.update({
            where: { id: o.id },
            data: {
              totalAmount: finance.totalAmount,
              platformFee: finance.platformFee,
              sellerRevenue: finance.sellerRevenue,
            },
          });
        }

        const sessionRow = await tx.checkoutSession.create({
          data: {
            buyerId: userId,
            totalAmount: preview.totalPayable,
            discountAmount: preview.discountAmount,
            couponId: preview.couponId,
            status: CheckoutSessionStatus.PENDING,
            source: input.source,
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

        if (input.clearCart) {
          const cart = await tx.cart.findUnique({ where: { userId } });
          if (cart) {
            await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
            await tx.cart.delete({ where: { id: cart.id } });
          }
        }

        return sessionRow;
      });
    } catch (err) {
      await this.rollbackCreatedOrders(createdOrders.map((o) => o.id));
      throw err;
    }

    let paymentUrl: string | null = null;
    try {
      if (input.paymentMethod === 'GATEWAY' && preview.totalPayable > 0) {
        const initiated =
          await this.paymentsService.initiateCheckoutSessionPayment(
            session.id,
            userId,
            undefined,
            undefined,
            input.clientMeta,
            input.gateway,
          );
        paymentUrl = initiated.paymentUrl;
      } else if (
        input.paymentMethod === 'WALLET' ||
        preview.totalPayable <= 0
      ) {
        await this.paymentsService.settleCheckoutSessionFromWallet(
          session.id,
          userId,
          input.clientMeta,
        );
      }
    } catch (err) {
      await this.rollbackSessionAndOrders(session.id);
      throw err;
    }

    const primaryOrder = await this.prisma.order.findUnique({
      where: { id: createdOrders[0].id },
    });

    return {
      ...primaryOrder,
      id: createdOrders[0].id,
      sessionId: session.id,
      orderIds: createdOrders.map((o) => o.id),
      totalAmount: preview.totalPayable,
      discountAmount: preview.discountAmount,
      paymentUrl,
      paymentMethod: input.paymentMethod as PaymentMethod,
    };
  }

  /**
   * تخفیف اول از سهم پلتفرم (کارمزد+کارشناسی در platformCut) کم می‌شود،
   * باقی‌مانده از درآمد فروشنده — تا sellerRevenue از total بیشتر نشود.
   */
  applyDiscountToOrderFinance(input: {
    totalAmount: number;
    platformFee: number;
    sellerRevenue: number;
    verificationFee: number;
    discountShare: number;
  }) {
    const discount = Math.max(0, Math.floor(input.discountShare));
    const newTotal = Math.max(0, input.totalAmount - discount);
    const platformCut = Math.max(
      0,
      input.totalAmount - input.sellerRevenue,
    );
    const newPlatformCut = Math.max(0, platformCut - discount);
    let newSellerRevenue = Math.max(0, newTotal - newPlatformCut);
    if (newSellerRevenue > newTotal) {
      newSellerRevenue = newTotal;
    }
    // platformFee stored field: keep non-negative and not exceeding remaining cut after verification
    const verification = Math.max(0, input.verificationFee);
    const newPlatformFee = Math.max(
      0,
      Math.min(input.platformFee, Math.max(0, newPlatformCut - verification)),
    );
    return {
      totalAmount: newTotal,
      platformFee: newPlatformFee,
      sellerRevenue: newSellerRevenue,
    };
  }

  private async rollbackCreatedOrders(orderIds: string[]): Promise<void> {
    for (const id of orderIds) {
      try {
        await this.prisma.order.delete({ where: { id } });
      } catch {
        /* already linked / gone */
      }
    }
  }

  private async rollbackSessionAndOrders(sessionId: string): Promise<void> {
    const session = await this.prisma.checkoutSession.findUnique({
      where: { id: sessionId },
      include: { orders: true },
    });
    if (!session) return;
    if (session.status === CheckoutSessionStatus.PAID) return;

    await this.prisma.checkoutSession.update({
      where: { id: sessionId },
      data: { status: CheckoutSessionStatus.CANCELLED },
    });
    for (const order of session.orders) {
      if (
        order.status === 'AWAITING_PAYMENT' ||
        order.status === 'PENDING'
      ) {
        try {
          await this.prisma.order.delete({ where: { id: order.id } });
        } catch {
          /* ignore */
        }
      }
    }
  }

  async buildLineFromListing(
    listingId: string,
    quantity: number,
    variationId?: string | null,
  ): Promise<MarketplaceCheckoutLine> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { direct: true },
    });
    if (!listing?.direct) {
      throw new BadRequestException('آگهی نامعتبر است');
    }
    let variation: {
      id: string;
      price: { toString(): string } | number | string;
      salePrice: { toString(): string } | number | string | null;
      isActive: boolean;
    } | null = null;
    if (listing.isVariable) {
      if (!variationId) {
        throw new BadRequestException('برای این محصول باید یک تنوع انتخاب کنید');
      }
      variation = await this.prisma.listingVariation.findFirst({
        where: { id: variationId, listingId, isActive: true },
      });
      if (!variation) {
        throw new BadRequestException('این تنوع دیگر قابل خرید نیست');
      }
    } else if (variationId) {
      throw new BadRequestException('این آگهی تنوع ندارد');
    }
    const shippingDefault = await this.readShippingCost();
    const currencyCode =
      listing.priceCurrencyCode?.toUpperCase() || BASE_CURRENCY_CODE;
    const priceFields = variation
      ? {
          price: Number(variation.price),
          salePrice:
            variation.salePrice != null ? Number(variation.salePrice) : null,
        }
      : listing.direct;
    const foreignUnit = resolveListingEffectiveUnitPrice(priceFields);
    let unitPrice: number;
    if (
      !variation &&
      listing.priceTomanCached != null &&
      Number(listing.priceTomanCached) > 0
    ) {
      unitPrice = Math.round(Number(listing.priceTomanCached));
    } else {
      unitPrice = await this.currency.toToman(foreignUnit, currencyCode);
    }
    const qty = Math.max(1, Math.floor(quantity || 1));
    const shippingCost =
      listing.shippingPayer === 'BUYER_PREPAID'
        ? listing.shippingCostOverride != null &&
          listing.shippingCostOverride >= 0
          ? listing.shippingCostOverride
          : shippingDefault
        : 0;
    return {
      listingId,
      variationId: variation?.id ?? null,
      quantity: qty,
      unitPrice,
      lineTotal: unitPrice * qty,
      shippingCost,
      categoryId: listing.categoryId,
      sellerId: listing.authorId,
      onSale:
        priceFields.salePrice != null && Number(priceFields.salePrice) > 0,
    };
  }

  private async readShippingCost(): Promise<number> {
    const row = await this.prisma.systemSetting.findUnique({
      where: { key: 'SHIPPING_COST' },
    });
    return Number(row?.value ?? 0);
  }
}
