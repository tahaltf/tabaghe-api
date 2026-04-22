import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminSmsBroadcastDto } from '../dto/admin-sms.dto';
import { AdminSmsService } from '../services/admin-sms.service';

@Controller('admin/sms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSmsController {
  constructor(private readonly adminSms: AdminSmsService) {}

  @Post('broadcast')
  broadcast(@Body() dto: AdminSmsBroadcastDto) {
    return this.adminSms.broadcast(dto);
  }
}
