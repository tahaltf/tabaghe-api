import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { SurveysService } from './surveys.service';
import { AdminSurveyListQueryDto } from './dto/admin-survey-list-query.dto';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('surveys.view')
export class AdminSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  list(@Query() query: AdminSurveyListQueryDto) {
    return this.surveys.adminList(query);
  }
}
