import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from "../modules/auth/guards/jwt-auth.guard";

@Controller('orders')
@UseGuards(JwtAuthGuard) // حتما باید کاربر لاگین باشه
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('my-orders')
  async getMyOrders(@Request() req) {
    return this.ordersService.getMyOrders(req.user.id);
  }

  @Get('my-requests')
  async getMyRequests(@Request() req) {
    return this.ordersService.getMyRequests(req.user.id);
  }
}