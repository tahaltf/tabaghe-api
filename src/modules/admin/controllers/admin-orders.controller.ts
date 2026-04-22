import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminOrdersQueryService } from '../services/admin-orders-query.service';
import { AdminOrdersCommandService } from '../services/admin-orders-command.service';
import { AdminOrderListQueryDto } from '../dto/admin-query.dto';
import {
  UpdateOrderStatusDto,
  UpdateTrackingCodeDto,
} from '../dto/admin-order.dto';

@Controller('admin/orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminOrdersQueryController {
  constructor(
    private readonly query: AdminOrdersQueryService,
    private readonly command: AdminOrdersCommandService,
  ) {}

  @Get('all')
  list(@Query() query: AdminOrderListQueryDto) {
    return this.query.list(query);
  }

  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.query.detail(id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.command.updateStatus(id, dto.status, dto.note);
  }

  @Patch(':id/tracking-code')
  setTrackingCode(
    @Param('id') id: string,
    @Body() dto: UpdateTrackingCodeDto,
  ) {
    return this.command.setTrackingCode(id, dto.trackingCode);
  }
}
