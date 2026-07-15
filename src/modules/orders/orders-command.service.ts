import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { CheckoutSessionSource, OrderType } from '@prisma/client';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';
import { MarketplaceCheckoutService } from '../cart/marketplace-checkout.service';
import type { ClientRequestMeta } from '../../common/http/client-ip.util';

@Injectable()
export class OrdersCommandService {
  constructor(
    private readonly checkout: OrdersCheckoutService,
    private readonly shipping: OrdersShippingService,
    private readonly completion: OrdersCompletionService,
    @Inject(forwardRef(() => MarketplaceCheckoutService))
    private readonly marketplaceCheckout: MarketplaceCheckoutService,
  ) {}

  async createOrder(
    userId: string,
    dto: CreateOrderDto,
    clientMeta?: ClientRequestMeta,
  ) {
    if (dto.orderType === OrderType.DIRECT && dto.listingId && dto.addressId) {
      const line = await this.marketplaceCheckout.buildLineFromListing(
        dto.listingId,
        dto.quantity ?? 1,
      );
      return this.marketplaceCheckout.checkoutLines(userId, {
        source: CheckoutSessionSource.DIRECT,
        addressId: dto.addressId,
        paymentMethod: dto.paymentMethod as 'GATEWAY' | 'WALLET',
        couponCode: dto.couponCode,
        requiresVerification: dto.requiresVerification,
        clearCart: false,
        items: [line],
        clientMeta,
      });
    }
    return this.checkout.handleUniversalOrder(userId, dto, clientMeta);
  }

  updateTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    return this.shipping.updateTrackingCode(
      userId,
      orderId,
      trackingCode,
      videoPath,
    );
  }

  submitReturnTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    return this.completion.submitReturnTrackingCode(
      userId,
      orderId,
      trackingCode,
      videoPath,
    );
  }

  confirmReturnReceipt(userId: string, orderId: string) {
    return this.completion.confirmReturnReceipt(userId, orderId);
  }

  confirmOrder(userId: string, orderId: string) {
    return this.completion.confirmOrder(userId, orderId);
  }

  disputeOrder(
    userId: string,
    orderId: string,
    reason: string,
    videoPath?: string,
  ) {
    return this.completion.disputeOrder(userId, orderId, reason, videoPath);
  }

  setExchangeSellerRelistChoice(
    userId: string,
    orderId: string,
    publish: boolean,
  ) {
    return this.shipping.setExchangeSellerRelistChoice(
      userId,
      orderId,
      publish,
    );
  }
}
