import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminOrdersQueryService } from '../services/admin-orders-query.service';
import { AdminOrdersCommandService } from '../services/admin-orders-command.service';
import { AdminOrderListQueryDto } from '../dto/admin-query.dto';
import {
  FinalizeExchangeHubInspectionDto,
  ResolveOrderEscrowDto,
  RejectExchangeFakeShipmentDto,
  SetExchangeHubReceiptDto,
  SetParticipantShippingDto,
  SetHubShippingCodesDto,
  UpdateOrderStatusDto,
  UpdateTrackingCodeDto,
} from '../dto/admin-order.dto';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('orders.view')
export class AdminOrdersQueryController {
  constructor(
    private readonly query: AdminOrdersQueryService,
    private readonly command: AdminOrdersCommandService,
  ) {}

  @Get('all')
  list(@Query() query: AdminOrderListQueryDto) {
    return this.query.list(query);
  }

  /** لیست سفارش‌های DIRECT که امانت خرید / لاگ مالی ناقص دارند */
  @Get('missing-purchase-escrow')
  listMissingPurchaseEscrow(@Query('limit') limit?: string) {
    const parsed = Number(limit);
    return this.command.listMissingPurchaseEscrow(
      Number.isFinite(parsed) ? parsed : 100,
    );
  }

  /** تعمیر دسته‌ای امانت خرید برای سفارش‌های خراب */
  @Post('repair-missing-purchase-escrow')
  @RequirePermission('orders.update')
  repairAllMissingPurchaseEscrow(
    @Body() body?: { force?: boolean; limit?: number },
  ) {
    return this.command.repairAllMissingPurchaseEscrow({
      force: Boolean(body?.force),
      limit: body?.limit,
    });
  }

  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.query.detail(id);
  }

  /** ثبت دستی تراکنش بازگشت وجه خریدار اگر سفارش لغوشده ولی لاگ مالی ندارد */
  @Post(':id/repair-buyer-refund')
  @RequirePermission('orders.update')
  repairBuyerRefund(@Param('id') id: string) {
    return this.command.repairBuyerRefundForCancelledOrder(id);
  }

  /** ثبت امانت خرید (بلوکه فروشنده + لاگ خریدار) اگر بعد از پرداخت درگاه جا افتاده */
  @Post(':id/repair-purchase-escrow')
  @RequirePermission('orders.update')
  repairPurchaseEscrow(
    @Param('id') id: string,
    @Body() body?: { force?: boolean },
  ) {
    return this.command.repairMissingPurchaseEscrow(id, Boolean(body?.force));
  }

  @Patch(':id/status')
  @RequirePermission('orders.update')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.command.updateStatus(
      id,
      dto.status,
      dto.note,
      dto.rejectedReturnTrackingCode,
    );
  }

  @Patch(':id/exchange-hub-inspection')
  @RequirePermission('orders.update')
  finalizeExchangeHubInspection(
    @Param('id') id: string,
    @Body() dto: FinalizeExchangeHubInspectionDto,
  ) {
    return this.command.finalizeExchangeHubInspection(id, dto);
  }

  @Patch(':id/tracking-code')
  @RequirePermission('orders.update')
  setTrackingCode(@Param('id') id: string, @Body() dto: UpdateTrackingCodeDto) {
    return this.command.setTrackingCode(id, dto.trackingCode);
  }

  @Patch(':id/participant-shipping')
  @RequirePermission('orders.update')
  setParticipantShipping(
    @Param('id') id: string,
    @Body() dto: SetParticipantShippingDto,
  ) {
    return this.command.setParticipantShipping(id, dto);
  }

  @Patch(':id/exchange-hub-receipt')
  @RequirePermission('orders.update')
  setExchangeHubReceipt(
    @Param('id') id: string,
    @Body() dto: SetExchangeHubReceiptDto,
  ) {
    return this.command.setExchangeHubReceipt(id, dto);
  }

  @Patch(':id/exchange-reject-fake-shipment')
  @RequirePermission('orders.update')
  rejectExchangeFakeShipment(
    @Param('id') id: string,
    @Body() dto: RejectExchangeFakeShipmentDto,
  ) {
    return this.command.rejectExchangeFakeShipment(id, dto);
  }

  @Patch(':id/hub-shipping')
  @RequirePermission('orders.update')
  setHubShippingCodes(
    @Param('id') id: string,
    @Body() dto: SetHubShippingCodesDto,
  ) {
    return this.command.setHubShippingCodes(id, dto);
  }

  @Patch(':id/escrow')
  @RequirePermission('orders.update')
  resolveEscrow(@Param('id') id: string, @Body() dto: ResolveOrderEscrowDto) {
    return this.command.resolveEscrow(id, dto);
  }
}
