import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminProductRequestsService } from '../services/admin-product-requests.service';
import { AdminListQueryDto } from '../dto/admin-query.dto';

@Controller('admin/product-requests')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('product_requests.view')
export class AdminProductRequestsController {
  constructor(private readonly service: AdminProductRequestsService) {}

  @Get()
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  list(@Query() query: AdminListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }
}
