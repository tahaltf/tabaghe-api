import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminUpsertWordPressSyncPolicyDto } from '../dto/admin-wordpress-sync-policy.dto';
import { WordPressConnectionService } from '../services/connection.service';

@Controller('admin/users/:id/wordpress-sync')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('users.view')
export class AdminWordPressSyncPolicyController {
  constructor(private readonly connections: WordPressConnectionService) {}

  @Get()
  get(@Param('id') userId: string) {
    return this.connections.getSyncPolicyForAdmin(userId);
  }

  @Put()
  @RequirePermission('users.update')
  upsert(
    @Param('id') userId: string,
    @Body() dto: AdminUpsertWordPressSyncPolicyDto,
  ) {
    return this.connections.upsertSyncPolicyForAdmin(userId, dto);
  }
}
