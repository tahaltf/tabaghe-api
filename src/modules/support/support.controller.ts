import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Express } from 'express';
import { SupportService } from './support.service';
import { CreateTicketDto, SendMessageDto } from './dto/create-ticket.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { ticketAttachmentMulterOptions } from '../../common/upload/ticket-attachment-upload.config';

@Controller('support')
@UseGuards(JwtAuthGuard)
export class SupportController {
  constructor(private readonly supportService: SupportService) {}

  @Get('ticket-attachment-settings')
  getAttachmentSettings() {
    return this.supportService.getAttachmentSettings();
  }

  @Get('tickets')
  async getMyTickets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.supportService.getMyTickets(user.id, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('tickets/:id')
  async getTicketDetails(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.supportService.getTicketDetails(id, user.id);
  }

  @Post('tickets')
  @UseInterceptors(FileInterceptor('attachment', ticketAttachmentMulterOptions))
  async createTicket(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateTicketDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.supportService.createTicket(user.id, dto, file);
  }

  @Post('tickets/:id/messages')
  @UseInterceptors(FileInterceptor('attachment', ticketAttachmentMulterOptions))
  async sendMessage(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SendMessageDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.supportService.sendMessage(id, user.id, dto.message, file);
  }
}
