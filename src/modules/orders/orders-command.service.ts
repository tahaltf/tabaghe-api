import { Injectable } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersCommandService {
  constructor(private readonly ordersService: OrdersService) {}

  createOrder(userId: string, dto: CreateOrderDto) {
    return this.ordersService.handleUniversalOrder(userId, dto);
  }

  updateTrackingCode(userId: string, orderId: string, trackingCode: string, videoPath?: string) {
    return this.ordersService.updateTrackingCode(userId, orderId, trackingCode, videoPath);
  }

  submitReturnTrackingCode(userId: string, orderId: string, trackingCode: string, videoPath?: string) {
    return this.ordersService.submitReturnTrackingCode(userId, orderId, trackingCode, videoPath);
  }

  confirmOrder(userId: string, orderId: string) {
    return this.ordersService.confirmOrder(userId, orderId);
  }

  disputeOrder(userId: string, orderId: string, reason: string, videoPath?: string) {
    return this.ordersService.disputeOrder(userId, orderId, reason, videoPath);
  }
}
