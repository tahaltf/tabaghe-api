import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { NotificationService } from '../../notification/notification.service';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BroadcastNotificationDto } from '../dto/admin-notification.dto';
import { resolveAdminRecipientUserIds } from '../utils/admin-recipient.util';

@Controller('admin/notifications')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('notifications.view')
export class AdminNotificationsController {
  constructor(
    private readonly notifications: NotificationService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const p = Math.max(1, Number(page) || 1);
    const ps = Math.min(100, Math.max(1, Number(pageSize) || 20));
    const where: Prisma.NotificationWhereInput = {};
    if (search) {
      const s = search.trim();
      where.OR = [
        { title: { contains: s, mode: 'insensitive' } },
        { message: { contains: s, mode: 'insensitive' } },
      ];
    }
    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: {
          user: {
            select: { id: true, phone: true, firstName: true, lastName: true, displayName: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: p,
        pageSize: ps,
        total,
        totalPages: Math.max(1, Math.ceil(total / ps)),
      },
    };
  }

  @Post('broadcast')
  @RequirePermission('notifications.create')
  async broadcast(@Body() dto: BroadcastNotificationDto) {
    const userIds = await resolveAdminRecipientUserIds(
      this.prisma,
      dto.userIds,
      dto.phones,
    );
    if (Array.isArray(userIds) && userIds.length === 0) {
      throw new BadRequestException('حداقل یک گیرنده انتخاب کنید');
    }
    return this.notifications.broadcast({
      title: dto.title,
      message: dto.message,
      linkUrl: dto.linkUrl,
      alsoSendSms: dto.alsoSendSms,
      smsTemplateConfig: dto.smsTemplateConfig,
      userIds,
    });
  }
}
