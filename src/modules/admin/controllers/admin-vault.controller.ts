import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { VaultPurgeDto } from '../dto/admin-vault.dto';
import { AdminVaultService } from '../services/admin-vault.service';
import type { AuthenticatedUser } from '../../../shared/contracts/auth';

@Controller('admin/vault')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminVaultController {
  constructor(private readonly vault: AdminVaultService) {}

  @Get('stats')
  getStats() {
    return this.vault.getStats();
  }

  @Post('purge')
  purge(
    @Body() dto: VaultPurgeDto,
    @Req() req: Request & { user: AuthenticatedUser },
  ) {
    return this.vault.purge(dto.target, dto.confirmPhrase, req.user.id);
  }
}
