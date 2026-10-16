import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminTicketsService } from '../services/admin-tickets.service';
import { AdminTicketListQueryDto } from '../dto/admin-query.dto';
import {
  AdminCreateTicketDto,
  AdminReplyTicketDto,
  AdminUpdateTicketDto,
} from '../dto/admin-ticket.dto';
import { ticketAttachmentMulterOptions } from '../../../common/upload/ticket-attachment-upload.config';
import { validateUploadedFileSignature } from '../../../common/upload/validate-uploaded-file.util';

@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('tickets.view')
export class AdminTicketsController {
  constructor(private readonly service: AdminTicketsService) {}

  @Get()
  list(@Query() query: AdminTicketListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post('user/:userId')
  @RequirePermission('tickets.update')
  @UseInterceptors(FileInterceptor('attachment', ticketAttachmentMulterOptions))
  createForUser(
    @Param('userId') userId: string,
    @Body() dto: AdminCreateTicketDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    validateUploadedFileSignature(
      file,
      ['jpeg', 'png', 'webp', 'gif', 'pdf'],
      'پیوست تیکت',
    );
    return this.service.createForUser(userId, dto, file);
  }

  @Post(':id/reply')
  @RequirePermission('tickets.update')
  @UseInterceptors(FileInterceptor('attachment', ticketAttachmentMulterOptions))
  reply(
    @Param('id') id: string,
    @Body() dto: AdminReplyTicketDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    validateUploadedFileSignature(
      file,
      ['jpeg', 'png', 'webp', 'gif', 'pdf'],
      'پیوست تیکت',
    );
    return this.service.reply(id, dto, file);
  }

  @Patch(':id/status')
  @RequirePermission('tickets.update')
  updateStatus(@Param('id') id: string, @Body() dto: AdminUpdateTicketDto) {
    return this.service.updateStatus(id, dto);
  }
}
