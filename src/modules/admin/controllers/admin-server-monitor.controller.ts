import { Controller, Get, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminServerMonitorService } from '../services/admin-server-monitor.service';

@Controller('admin/server-monitor')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminServerMonitorController {
  constructor(private readonly monitor: AdminServerMonitorService) {}

  @Get()
  getOverview() {
    return this.monitor.getOverview();
  }
}
