import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminDisputesService } from '../services/admin-disputes.service';
import {
  AdminDisputeListQueryDto,
  ResolveDisputeDto,
} from '../dto/admin-dispute.dto';

@Controller('admin/disputes')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('disputes.view')
export class AdminDisputesController {
  constructor(private readonly service: AdminDisputesService) {}

  @Get()
  list(@Query() query: AdminDisputeListQueryDto) {
    return this.service.list(query);
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/resolve')
  @RequirePermission('disputes.update')
  resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @Req() req: Request,
  ) {
    const adminId = (req.user as { id: string }).id;
    return this.service.resolve(id, adminId, dto);
  }
}
