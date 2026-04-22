import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AdminUsersService, KycRequest } from './admin-users.service';
import { RejectKycDto } from './dto/reject-kyc.dto';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get('kyc-requests')
  listPendingKyc(): Promise<KycRequest[]> {
    return this.adminUsersService.listPendingKyc();
  }

  @Patch(':id/approve-kyc')
  approveKyc(@Param('id') targetUserId: string) {
    return this.adminUsersService.approve(targetUserId);
  }

  @Patch(':id/reject-kyc')
  rejectKyc(@Param('id') targetUserId: string, @Body() dto: RejectKycDto) {
    const reason = dto.reason?.trim() || 'مدارک هویتی ناخوانا یا نامعتبر است';
    return this.adminUsersService.reject(targetUserId, reason);
  }
}
