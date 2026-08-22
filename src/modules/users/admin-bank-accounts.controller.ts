import { Body, Controller, Get, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../shared/contracts/auth';
import { BankAccountsService } from './bank-accounts.service';
import { RejectBankAccountDto } from './dto/reject-bank-account.dto';
import { extractClientIp } from '../../common/http/client-ip.util';

@Controller('admin/bank-accounts')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('users.view')
export class AdminBankAccountsController {
  constructor(private readonly bankAccounts: BankAccountsService) {}

  @Get('pending')
  listPending() {
    return this.bankAccounts.listPendingForAdmin();
  }

  @Patch(':id/approve')
  @RequirePermission('users.update')
  approve(
    @Param('id') accountId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.bankAccounts.approveBankAccount(
      accountId,
      admin.id,
      extractClientIp(req),
    );
  }

  @Patch(':id/reject')
  @RequirePermission('users.update')
  reject(
    @Param('id') accountId: string,
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: RejectBankAccountDto,
  ) {
    return this.bankAccounts.rejectBankAccount(accountId, admin.id, dto.reason);
  }
}
