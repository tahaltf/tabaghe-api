import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UpdateSystemJobSettingsDto } from '../dto/admin-system-jobs.dto';
import { AdminSystemJobsService } from '../services/admin-system-jobs.service';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';

@Controller('admin/system-jobs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminSystemJobsController {
  constructor(private readonly systemJobs: AdminSystemJobsService) {}

  @Get()
  getOverview() {
    return this.systemJobs.getOverview();
  }

  @Patch('settings')
  updateSettings(
    @Body() dto: UpdateSystemJobSettingsDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.systemJobs.updateSettings(dto, req.user.id);
  }
}
