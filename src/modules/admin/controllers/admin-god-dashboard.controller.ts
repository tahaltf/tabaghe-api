import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  AdminGodDashboardService,
  GOD_RANGES,
  GodRange,
} from '../services/admin-god-dashboard.service';

@Controller('admin/god-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminGodDashboardController {
  constructor(private readonly service: AdminGodDashboardService) {}

  @Get('overview')
  overview(@Query('range') range?: string) {
    const r = (range ?? '24h') as GodRange;
    if (!GOD_RANGES.includes(r)) {
      throw new BadRequestException('بازه زمانی نامعتبر است');
    }
    return this.service.getOverview(r);
  }
}
