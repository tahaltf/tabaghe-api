import { Injectable } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersCheckoutService } from './services/command/orders-checkout.service';
import { OrdersShippingService } from './services/command/orders-shipping.service';
import { OrdersCompletionService } from './services/command/orders-completion.service';
import { OrdersSchedulerService } from './services/scheduler/orders-scheduler.service';

/**
 * Backward-compatible facade. Prefer injecting specialized services directly.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly checkout: OrdersCheckoutService,
    private readonly shipping: OrdersShippingService,
    private readonly completion: OrdersCompletionService,
    private readonly scheduler: OrdersSchedulerService,
  ) {}

  handleUniversalOrder(userId: string, dto: CreateOrderDto | Record<string, unknown>) {
    return this.checkout.handleUniversalOrder(userId, dto);
  }

  updateTrackingCode(
    userId: string,
    orderId: string,
    trackingCode: string,
    videoPath?: string,
  ) {
    return this.shipping.updateTrackingCode(userId, orderId, trackingCode, videoPath);
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

  confirmReturnReceipt(sellerId: string, orderId: string) {
    return this.completion.confirmReturnReceipt(sellerId, orderId);
  }

  tryAutoConfirmSellerReturnReceipt(orderId: string) {
    return this.completion.tryAutoConfirmSellerReturnReceipt(orderId);
  }

  autoConfirmSellerReturnReceipt() {
    return this.completion.autoConfirmSellerReturnReceipt();
  }

  setExchangeSellerRelistChoice(userId: string, orderId: string, publish: boolean) {
    return this.shipping.setExchangeSellerRelistChoice(userId, orderId, publish);
  }

  confirmOrder(userId: string, orderId: string) {
    return this.completion.confirmOrder(userId, orderId);
  }

  disputeOrder(userId: string, orderId: string, reason: string, videoPath?: string) {
    return this.completion.disputeOrder(userId, orderId, reason, videoPath);
  }

  computeBuyerConfirmDeadlineNow() {
    return this.scheduler.computeBuyerConfirmDeadlineNow();
  }

  ensureBuyerConfirmDeadline(orderId: string) {
    return this.scheduler.ensureBuyerConfirmDeadline(orderId);
  }

  tryAutoConfirmExpiredOrder(orderId: string) {
    return this.scheduler.tryAutoConfirmExpiredOrder(orderId);
  }

  isShippingDeadlineExpired(order: Parameters<OrdersSchedulerService['isShippingDeadlineExpired']>[0]) {
    return this.scheduler.isShippingDeadlineExpired(order);
  }

  tryCancelExpiredShippingForOrder(orderId: string) {
    return this.scheduler.tryCancelExpiredShippingForOrder(orderId);
  }

  autoCancelExpiredOrders() {
    return this.scheduler.autoCancelExpiredOrders();
  }

  autoReconcileStaleExchangeOfferStatus() {
    return this.scheduler.autoReconcileStaleExchangeOfferStatus();
  }

  autoCancelTimedOutExchangeCompletions() {
    return this.scheduler.autoCancelTimedOutExchangeCompletions();
  }

  autoConfirmOrders() {
    return this.scheduler.autoConfirmOrders();
  }

  autoReleaseExchangeReturnEscrow() {
    return this.scheduler.autoReleaseExchangeReturnEscrow();
  }

  purgeCompletedOrderVideos() {
    return this.scheduler.purgeCompletedOrderVideos();
  }
}
