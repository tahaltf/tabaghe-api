import {
  Controller, Patch, Body, Req, UseGuards, Get, Param,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('kyc-requests')
  async getPendingKycRequests() {
    return this.usersService.getPendingKycRequests();
  }

  @Patch(':id/approve-kyc')
  async approveKyc(@Req() req: any, @Param('id') targetUserId: string) {
    return this.usersService.approveKyc(req.user.sub, targetUserId);
  }

  @Patch(':id/reject-kyc')
  async rejectKyc(
    @Req() req: any,
    @Param('id') targetUserId: string,
    @Body('reason') reason: string
  ) {
    return this.usersService.rejectKyc(req.user.sub, targetUserId, reason || 'مدارک هویتی ناخوانا یا نامعتبر است');
  }
}