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
import { AdminGodCommandService } from '../services/admin-god-command.service';

@Controller('admin/god-dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminGodDashboardController {
  constructor(
    private readonly service: AdminGodDashboardService,
    private readonly command: AdminGodCommandService,
  ) {}

  @Get('overview')
  overview(@Query('range') range?: string) {
    return this.service.getOverview(this.parseRange(range));
  }

  @Get('command')
  commandCenter(@Query('range') range?: string) {
    return this.command.getCommand(this.parseRange(range));
  }

  private parseRange(range?: string): GodRange {
    const r = (range ?? '24h') as GodRange;
    if (!GOD_RANGES.includes(r)) {
      throw new BadRequestException('بازه زمانی نامعتبر است');
    }
    return r;
  }
}
