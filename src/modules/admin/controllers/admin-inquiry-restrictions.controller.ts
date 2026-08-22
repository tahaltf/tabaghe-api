import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { InquiryRestrictionService } from '../../zohal/inquiry-restriction.service';
import { AuthenticatedUser } from '../../../shared/contracts/auth';

@Controller('admin/inquiry-restrictions')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
export class AdminInquiryRestrictionsController {
  constructor(private readonly restrictions: InquiryRestrictionService) {}

  @Get()
  @RequirePermission('admin.settings.read')
  list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.restrictions.listBlockedUsers(
      Math.max(0, parseInt(String(skip ?? '0'), 10) || 0),
      Math.min(100, Math.max(1, parseInt(String(take ?? '50'), 10) || 50)),
    );
  }

  @Get('users/:userId')
  @RequirePermission('admin.users.read')
  getUser(@Param('userId') userId: string) {
    return this.restrictions.getSnapshot(userId);
  }

  @Patch('users/:userId')
  @RequirePermission('admin.users.write')
  updateUser(
    @Param('userId') userId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body()
    body: {
      inquiryBlocked?: boolean;
      manualEntryOnly?: boolean;
      maxInquiriesPerMinute?: number | null;
      maxInquiriesPerDay?: number | null;
      maxBankAccounts?: number | null;
      resetCounters?: boolean;
      unblock?: boolean;
    },
  ) {
    return this.restrictions.adminUpdate(userId, body, admin.id);
  }
}
