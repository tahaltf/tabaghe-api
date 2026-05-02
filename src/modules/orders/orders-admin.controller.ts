import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { OrderStatus, UserRole } from '@prisma/client';

import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { OrdersAdminService } from './orders-admin.service';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class OrdersAdminController {
  constructor(private readonly ordersAdminService: OrdersAdminService) {}

  @Get('hub')
  getHubOrders() {
    return this.ordersAdminService.getHubOrders();
  }

  @Patch(':id/hub-status')
  updateHubStatus(
    @Param('id') id: string,
    @Body()
    body: {
      status: OrderStatus;
      hubToBuyerTrackingCode?: string;
      hubToSellerTrackingCode?: string;
    },
  ) {
    if (!body.status) {
      throw new BadRequestException('وضعیت (status) الزامی است');
    }

    return this.ordersAdminService.updateHubStatus(
      id,
      body.status,
      body.hubToBuyerTrackingCode,
      body.hubToSellerTrackingCode,
    );
  }

  @Patch(':id/exchange-hub-receipt')
  setExchangeHubReceipt(
    @Param('id') id: string,
    @Body()
    body: {
      side: 'LISTING' | 'OFFER';
      received: boolean;
    },
  ) {
    if (!body?.side || (body.side !== 'LISTING' && body.side !== 'OFFER')) {
      throw new BadRequestException('فیلد side باید LISTING یا OFFER باشد');
    }
    if (typeof body.received !== 'boolean') {
      throw new BadRequestException('فیلد received باید boolean باشد');
    }
    return this.ordersAdminService.setExchangeHubReceipt(id, body);
  }
}
