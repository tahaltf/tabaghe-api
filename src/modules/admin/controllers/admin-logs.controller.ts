import {
  Controller,
  DefaultValuePipe,
  Get,
  ParseIntPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminLogsService } from '../services/admin-logs.service';

@Controller('admin/logs')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('logs.view')
export class AdminLogsController {
  constructor(private readonly logs: AdminLogsService) {}

  @Get('errors')
  errors(
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.logs.listAppErrors(limit);
  }

  @Get('terms-consents')
  termsConsents(
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.logs.listTermsConsents(limit);
  }

  @Get('auction-ledger')
  auctionLedger(
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
  ) {
    return this.logs.listAuctionLedger(limit);
  }

  @Get('auction-timeline')
  auctionTimeline(
    @Query('limit', new DefaultValuePipe(500), ParseIntPipe) limit: number,
  ) {
    return this.logs.listAuctionTimeline(limit);
  }

  @Get('settings-audit')
  settingsAudit(
    @Query('limit', new DefaultValuePipe(200), ParseIntPipe) limit: number,
  ) {
    return this.logs.listSettingsAudit(limit);
  }
}
