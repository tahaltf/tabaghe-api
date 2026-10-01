import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import {
  AdminImportProductFeedDto,
  AdminUpsertProductFeedDto,
} from '../dto/admin-product-feed.dto';
import { ProductFeedConfigService } from '../services/product-feed-config.service';
import { ProductFeedSyncService } from '../services/product-feed-sync.service';

@Controller('admin/users/:id/product-feed')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('users.view')
export class AdminProductFeedController {
  constructor(
    private readonly config: ProductFeedConfigService,
    private readonly sync: ProductFeedSyncService,
  ) {}

  @Get()
  get(@Param('id') userId: string) {
    return this.config.getForUser(userId);
  }

  @Put()
  @RequirePermission('users.update')
  upsert(@Param('id') userId: string, @Body() dto: AdminUpsertProductFeedDto) {
    return this.config.upsertForUser(userId, dto);
  }

  @Post('preview')
  @RequirePermission('users.update')
  preview(@Param('id') userId: string) {
    return this.sync.previewUserFeed(userId);
  }

  @Post('import')
  @RequirePermission('users.update')
  async importSelected(
    @Param('id') userId: string,
    @Body() dto: AdminImportProductFeedDto,
  ) {
    const result = await this.sync.importSelectedProducts(
      userId,
      dto.productIds,
      dto.categoryId,
    );
    const config = await this.config.getForUser(userId);
    return { ...config, syncResult: result };
  }

  @Post('sync')
  @RequirePermission('users.update')
  async syncNow(@Param('id') userId: string) {
    const result = await this.sync.syncUserFeed(userId);
    const config = await this.config.getForUser(userId);
    return { ...config, syncResult: result };
  }
}
