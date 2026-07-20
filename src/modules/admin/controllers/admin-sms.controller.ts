import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminSmsBroadcastDto } from '../dto/admin-sms.dto';
import { AdminSmsService } from '../services/admin-sms.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { resolveAdminRecipientUserIds } from '../utils/admin-recipient.util';

@Controller('admin/sms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSmsController {
  constructor(
    private readonly adminSms: AdminSmsService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('broadcast')
  async broadcast(@Body() dto: AdminSmsBroadcastDto) {
    const userIds = await resolveAdminRecipientUserIds(
      this.prisma,
      dto.userIds,
      dto.phones,
    );
    if (Array.isArray(userIds) && userIds.length === 0) {
      throw new BadRequestException('حداقل یک گیرنده انتخاب کنید');
    }
    return this.adminSms.broadcast({
      templateId: dto.templateId,
      templateName: dto.templateName,
      parameterName: dto.parameterName,
      parameterValue: dto.parameterValue,
      userIds,
      siteTitle: dto.siteTitle,
      alsoCreateSiteNotification: dto.alsoCreateSiteNotification,
    });
  }
}
