import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  Query
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('orders')
@UseGuards(JwtAuthGuard) // حتما باید کاربر لاگین باشه
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  async createOrder(@Request() req, @Body() dto: any) {
    return this.ordersService.handleUniversalOrder(req.user.id, dto);
  }

  // ثبت کد رهگیری پستی
  @Patch(':id/shipping')
  async updateTrackingCode(
    @Request() req,
    @Param('id') id: string,
    @Body('trackingCode') trackingCode: string,
  ) {
    if (!trackingCode) {
      throw new BadRequestException('لطفا کد رهگیری را وارد کنید');
    }
    return this.ordersService.updateTrackingCode(req.user.id, id, trackingCode);
  }

  // تایید دریافت کالا
  @Patch(':id/confirm')
  async confirmOrderDelivery(@Request() req, @Param('id') id: string) {
    return this.ordersService.confirmOrder(req.user.id, id);
  }

  // 👈 مشکل دقیقا اینجا بود! الان به type=SELL حساس شد
  @Get('my-orders')
  async getMyOrders(@Request() req, @Query('type') type?: string) {
    // اگر فرانت type رو SELL بفرسته، فروش‌ها رو میاره، در غیر این صورت خریدهارو میاره
    const orderType = type === 'SELL' ? 'SELL' : 'BUY';
    return this.ordersService.getOrdersByType(req.user.id, orderType);
  }

  @Get('requests')
  async getMyRequests(@Request() req) {
    return this.ordersService.getMyRequests(req.user.id);
  }

  // این متد برای ادمین یا بخش‌های دیگه است
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