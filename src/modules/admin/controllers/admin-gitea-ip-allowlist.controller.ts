/**
 * DISABLED (قابل برگشت): دسترسی Gitea IP
 * از admin.module و منو/روت فرانت خارج شده — برای فعال‌سازی دوباره uncomment کنید.
 */
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
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminGiteaIpAllowlistService } from '../services/admin-gitea-ip-allowlist.service';
import {
  CreateGiteaIpAllowlistDto,
  UpdateGiteaIpAllowlistConfigDto,
  UpdateGiteaIpAllowlistDto,
} from '../dto/admin-gitea-ip-allowlist.dto';

@Controller('admin/gitea-ip-allowlist')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('gitea_ip_allowlist.view')
export class AdminGiteaIpAllowlistController {
  constructor(private readonly service: AdminGiteaIpAllowlistService) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Patch('config')
  @RequirePermission('gitea_ip_allowlist.update')
  setConfig(@Body() dto: UpdateGiteaIpAllowlistConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Post('resync')
  @RequirePermission('gitea_ip_allowlist.update')
  resync() {
    return this.service.resync();
  }

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('gitea_ip_allowlist.create')
  create(@Body() dto: CreateGiteaIpAllowlistDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('gitea_ip_allowlist.update')
  update(@Param('id') id: string, @Body() dto: UpdateGiteaIpAllowlistDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('gitea_ip_allowlist.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
