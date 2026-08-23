import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminSmsIrService } from '../services/admin-smsir.service';
import {
  AdminSmsIrTemplatesQueryDto,
  CreateSmsIrTemplateDto,
} from '../dto/admin-smsir.dto';

@Controller('admin/smsir')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
export class AdminSmsIrController {
  constructor(private readonly service: AdminSmsIrService) {}

  @Get('credit')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getCredit() {
    return this.service.getCredit();
  }

  @Get('templates')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getTemplates(@Query() query: AdminSmsIrTemplatesQueryDto) {
    return this.service.getTemplates(
      query.page ?? 1,
      query.pageSize ?? 20,
      query.all === true,
    );
  }

  @Get('template-usage')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getTemplateUsage() {
    return this.service.getTemplateUsage();
  }

  @Post('templates')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  createTemplate(@Body() dto: CreateSmsIrTemplateDto) {
    return this.service.createTemplate(dto.title, dto.templateText);
  }
}
