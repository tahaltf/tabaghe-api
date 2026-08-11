import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('admin/coupons')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('coupons.view')
export class AdminCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  list(@Query('sellerId') sellerId?: string) {
    return this.couponsService.listAdmin(sellerId || undefined);
  }

  @Post()
  @RequirePermission('coupons.create')
  create(@Body() dto: CreateCouponDto) {
    return this.couponsService.createAdmin(dto);
  }

  @Patch(':id')
  @RequirePermission('coupons.update')
  update(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.couponsService.updateAdmin(id, dto);
  }

  @Delete(':id')
  @RequirePermission('coupons.delete')
  remove(@Param('id') id: string) {
    return this.couponsService.deleteAdmin(id);
  }
}
