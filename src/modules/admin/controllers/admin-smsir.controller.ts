import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
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
  AdminSmsIrArchiveQueryDto,
  AdminSmsIrLatestReceiveQueryDto,
  AdminSmsIrPageQueryDto,
  AdminSmsIrReceiveArchiveQueryDto,
  AdminSmsIrReceiveLiveQueryDto,
  AdminSmsIrSendBulkDto,
  AdminSmsIrSendLikeToLikeDto,
  AdminSmsIrSendSimpleDto,
  AdminSmsIrSendVerifyDto,
  AdminSmsIrTemplatesQueryDto,
  CreateSmsIrTemplateDto,
  UpdateSmsIrTemplateDto,
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

  @Get('lines')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLines() {
    return this.service.getLines();
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

  @Get('templates/:id')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.getTemplate(id);
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
    return this.service.createTemplate(dto.title, dto.templateText, dto.type);
  }

  @Put('templates/:id')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  updateTemplate(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSmsIrTemplateDto,
  ) {
    return this.service.updateTemplate(
      id,
      dto.title,
      dto.templateText,
      dto.type,
    );
  }

  @Delete('templates/:id')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteTemplate(@Param('id', ParseIntPipe) id: number) {
    return this.service.deleteTemplate(id);
  }

  @Post('send/bulk')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendBulk(@Body() dto: AdminSmsIrSendBulkDto) {
    return this.service.sendBulk(dto);
  }

  @Post('send/like-to-like')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendLikeToLike(@Body() dto: AdminSmsIrSendLikeToLikeDto) {
    return this.service.sendLikeToLike(dto);
  }

  @Delete('send/scheduled/:packId')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  deleteScheduled(@Param('packId') packId: string) {
    return this.service.deleteScheduled(packId);
  }

  @Post('send/verify')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendVerify(@Body() dto: AdminSmsIrSendVerifyDto) {
    return this.service.sendVerify(dto);
  }

  @Post('send/simple')
  @RequirePermission('settings.update')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  sendSimple(@Body() dto: AdminSmsIrSendSimpleDto) {
    return this.service.sendSimple(dto);
  }

  @Get('reports/message/:messageId')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getMessageReport(@Param('messageId', ParseIntPipe) messageId: number) {
    return this.service.getMessageReport(messageId);
  }

  @Get('reports/packs')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getTodayPacks(@Query() query: AdminSmsIrPageQueryDto) {
    return this.service.getTodayPacks({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    });
  }

  @Get('reports/packs/:packId')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getPackMessages(@Param('packId') packId: string) {
    return this.service.getPackMessages(packId);
  }

  @Get('reports/live')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLiveSends(@Query() query: AdminSmsIrPageQueryDto) {
    return this.service.getLiveSends({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
    });
  }

  @Get('reports/archive')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getArchivedSends(@Query() query: AdminSmsIrArchiveQueryDto) {
    return this.service.getArchivedSends({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  }

  @Get('receive/latest')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLatestReceived(@Query() query: AdminSmsIrLatestReceiveQueryDto) {
    return this.service.getLatestReceived(query.count);
  }

  @Get('receive/live')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getLiveReceived(@Query() query: AdminSmsIrReceiveLiveQueryDto) {
    return this.service.getLiveReceived({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
      sortByNewest: query.sortByNewest,
      mobile: query.mobile,
    });
  }

  @Get('receive/archive')
  @RequirePermission('settings.view', 'notification_settings.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  getArchivedReceived(@Query() query: AdminSmsIrReceiveArchiveQueryDto) {
    return this.service.getArchivedReceived({
      pageNumber: query.pageNumber,
      pageSize: query.pageSize,
      fromDate: query.fromDate,
      toDate: query.toDate,
      sortByNewest: query.sortByNewest,
    });
  }
}
