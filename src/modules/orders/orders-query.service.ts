import { Injectable } from '@nestjs/common';
import { OrdersService } from './orders.service';

@Injectable()
export class OrdersQueryService {
  constructor(private readonly ordersService: OrdersService) {}

  getOrdersByType(
    userId: string,
    type: 'BUY' | 'SELL',
    options: { page?: number; pageSize?: number } = {},
  ) {
    return this.ordersService.getOrdersByType(userId, type, options);
  }

  getMyRequests(
    userId: string,
    options: { page?: number; pageSize?: number } = {},
  ) {
    return this.ordersService.getMyRequests(userId, options);
  }

  getOrderById(userId: string, orderId: string) {
    return this.ordersService.getOrderById(userId, orderId);
  }
}
