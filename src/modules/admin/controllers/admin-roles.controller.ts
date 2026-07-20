import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { AdminRolesService } from '../services/admin-roles.service';
import {
  CreateAdminRoleDto,
  SetUserAdminRoleDto,
  UpdateAdminRoleDto,
} from '../dto/admin-role.dto';

@Controller('admin/rbac')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
export class AdminRolesController {
  constructor(private readonly service: AdminRolesService) {}

  /** دسترسی‌های کاربر فعلی برای فیلتر منو/دکمه‌ها */
  @Get('me')
  @Roles(UserRole.ADMIN)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMyAccess(user);
  }

  @Get('permissions/catalog')
  @Roles(UserRole.GODADMIN)
  catalog() {
    return this.service.catalog();
  }

  @Get('roles')
  @Roles(UserRole.GODADMIN)
  listRoles() {
    return this.service.listRoles();
  }

  @Get('roles/:id')
  @Roles(UserRole.GODADMIN)
  getRole(@Param('id') id: string) {
    return this.service.getRole(id);
  }

  @Post('roles')
  @Roles(UserRole.GODADMIN)
  createRole(@Body() dto: CreateAdminRoleDto) {
    return this.service.createRole(dto);
  }

  @Patch('roles/:id')
  @Roles(UserRole.GODADMIN)
  updateRole(@Param('id') id: string, @Body() dto: UpdateAdminRoleDto) {
    return this.service.updateRole(id, dto);
  }

  @Delete('roles/:id')
  @Roles(UserRole.GODADMIN)
  deleteRole(@Param('id') id: string) {
    return this.service.deleteRole(id);
  }

  @Patch('users/:userId/role')
  @Roles(UserRole.GODADMIN)
  setUserRole(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: SetUserAdminRoleDto,
  ) {
    return this.service.setUserAdminRole(actor, userId, dto.adminRoleId ?? null);
  }
}
