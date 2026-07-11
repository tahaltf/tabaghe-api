import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { SurveysService } from './surveys.service';
import { AdminSurveyListQueryDto } from './dto/admin-survey-list-query.dto';

@Controller('admin/surveys')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSurveysController {
  constructor(private readonly surveys: SurveysService) {}

  @Get()
  list(@Query() query: AdminSurveyListQueryDto) {
    return this.surveys.adminList(query);
  }
}
