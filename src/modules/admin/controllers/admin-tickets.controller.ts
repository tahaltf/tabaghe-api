import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminTicketsService } from '../services/admin-tickets.service';
import { AdminTicketListQueryDto } from '../dto/admin-query.dto';
import {
  AdminCreateTicketDto,
  AdminReplyTicketDto,
  AdminUpdateTicketDto,
} from '../dto/admin-ticket.dto';

@Controller('admin/tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
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
  createForUser(
    @Param('userId') userId: string,
    @Body() dto: AdminCreateTicketDto,
  ) {
    return this.service.createForUser(userId, dto);
  }

  @Post(':id/reply')
  reply(@Param('id') id: string, @Body() dto: AdminReplyTicketDto) {
    return this.service.reply(id, dto);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() dto: AdminUpdateTicketDto) {
    return this.service.updateStatus(id, dto);
  }
}
