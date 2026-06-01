import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';

@Injectable()
export class OrdersCommandService {
  constructor(
    private readonly checkout: OrdersCheckoutService,
    private readonly shipping: OrdersShippingService,
    private readonly completion: OrdersCompletionService,
  ) {}

  createOrder(userId: string, dto: CreateOrderDto) {
    return this.checkout.handleUniversalOrder(userId, dto);
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
