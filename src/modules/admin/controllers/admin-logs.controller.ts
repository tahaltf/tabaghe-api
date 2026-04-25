import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminLogsService } from '../services/admin-logs.service';

@Controller('admin/logs')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminLogsController {
  constructor(private readonly logs: AdminLogsService) {}

  @Get('errors')
  errors(@Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number) {
    return this.logs.listAppErrors(limit);
  }

  @Get('terms-consents')
  termsConsents(@Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number) {
    return this.logs.listTermsConsents(limit);
  }
}
