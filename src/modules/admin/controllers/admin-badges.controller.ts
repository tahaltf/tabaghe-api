import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { AdminBadgesService } from '../services/admin-badges.service';

@Controller('admin/badges')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('dashboard.view')
export class AdminBadgesController {
  constructor(private readonly badges: AdminBadgesService) {}

  /** Returns per-resource unseen counts together with each resource's lastSeenAt. */
  @Get()
  async getBadges(@CurrentUser() actor: AuthenticatedUser) {
    return this.badges.getBadges(actor.id);
  }

  /**
   * Marks a resource as seen by the current admin. Pass `{ resource: 'all' }` to mark all
   * resources at once. Returns the new lastSeenAt timestamp for the affected resource(s).
   */
  @Post('seen')
  async markSeen(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() body: { resource?: string },
  ) {
    return this.badges.markSeen(actor.id, body?.resource);
  }
}
