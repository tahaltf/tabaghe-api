import { Injectable } from '@nestjs/common';
import { OrdersListQueryService } from './services/query/orders-list-query.service';
import { OrdersDetailQueryService } from './services/query/orders-detail-query.service';

@Injectable()
export class OrdersQueryService {
  constructor(
    private readonly listQuery: OrdersListQueryService,
    private readonly detailQuery: OrdersDetailQueryService,
  ) {}

  getOrdersByType(
    userId: string,
    type: 'BUY' | 'SELL',
    options: { page?: number; pageSize?: number } = {},
  ) {
    return this.listQuery.getOrdersByType(userId, type, options);
  }

  getMyRequests(
    userId: string,
    options: {
      exchangePage?: number;
      auctionPage?: number;
      pageSize?: number;
    } = {},
  ) {
    return this.listQuery.getMyRequests(userId, options);
  }

  getOrderById(userId: string, orderId: string) {
    return this.detailQuery.getOrderById(userId, orderId);
  }
}
