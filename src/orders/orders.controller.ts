import {
  Controller,
  Get,
  UseGuards,
  Request,
  BadRequestException,
  Query
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../modules/auth/guards/jwt-auth.guard';

@Controller('orders')
@UseGuards(JwtAuthGuard) // حتما باید کاربر لاگین باشه
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('my-orders')
  async getMyOrders(@Request() req) {
    return this.ordersService.getMyOrders(req.user.id);
  }

  @Get('requests')
  async getMyRequests(@Request() req) {
    return this.ordersService.getMyRequests(req.user.id);
  }
  @Get()
  async getOrders(@Request() req, @Query('type') type: string) {
    if (!type || (type !== 'BUY' && type !== 'SELL')) {
      throw new BadRequestException('Order type (BUY or SELL) is required');
    }
    return this.ordersService.getOrdersByType(
      req.user.id,
      type as 'BUY' | 'SELL',
    );
  }
}
