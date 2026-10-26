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
import { AdminCrawlerIpAllowlistService } from '../services/admin-crawler-ip-allowlist.service';
import { AdminCrawlerPanelUsersService } from '../services/admin-crawler-panel-users.service';
import {
  CreateCrawlerIpAllowlistDto,
  UpdateCrawlerIpAllowlistConfigDto,
  UpdateCrawlerIpAllowlistDto,
} from '../dto/admin-crawler-ip-allowlist.dto';
import {
  CreateCrawlerAccessDto,
  CreateCrawlerPanelUserDto,
  UpdateCrawlerPanelUserDto,
} from '../dto/admin-crawler-panel-user.dto';

@Controller('admin/crawler-ip-allowlist')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('crawler_ip_allowlist.view')
export class AdminCrawlerIpAllowlistController {
  constructor(
    private readonly service: AdminCrawlerIpAllowlistService,
    private readonly panelUsers: AdminCrawlerPanelUsersService,
  ) {}

  @Get('config')
  getConfig() {
    return this.service.getConfig();
  }

  @Patch('config')
  @RequirePermission('crawler_ip_allowlist.update')
  setConfig(@Body() dto: UpdateCrawlerIpAllowlistConfigDto) {
    return this.service.updateConfig(dto);
  }

  @Post('resync')
  @RequirePermission('crawler_ip_allowlist.update')
  resync() {
    return this.service.resync();
  }

  @Get('users')
  listUsers() {
    return this.panelUsers.list();
  }

  @Post('users')
  @RequirePermission('crawler_ip_allowlist.create')
  createUser(@Body() dto: CreateCrawlerPanelUserDto) {
    return this.panelUsers.create(dto);
  }

  @Post('access')
  @RequirePermission('crawler_ip_allowlist.create')
  createAccess(@Body() dto: CreateCrawlerAccessDto) {
    return this.panelUsers.createAccess(dto);
  }

  @Patch('users/:userId')
  @RequirePermission('crawler_ip_allowlist.update')
  updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateCrawlerPanelUserDto,
  ) {
    return this.panelUsers.update(userId, dto);
  }

  @Post('users/:userId/reset-password')
  @RequirePermission('crawler_ip_allowlist.update')
  resetUserPassword(@Param('userId') userId: string) {
    return this.panelUsers.resetPassword(userId);
  }

  @Delete('users/:userId')
  @RequirePermission('crawler_ip_allowlist.delete')
  removeUser(@Param('userId') userId: string) {
    return this.panelUsers.remove(userId);
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
  @RequirePermission('crawler_ip_allowlist.create')
  create(@Body() dto: CreateCrawlerIpAllowlistDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('crawler_ip_allowlist.update')
  update(@Param('id') id: string, @Body() dto: UpdateCrawlerIpAllowlistDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('crawler_ip_allowlist.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
