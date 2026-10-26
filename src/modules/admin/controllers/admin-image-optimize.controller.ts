import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import {
  ImageOptimizeService,
  type OptimizeTarget,
} from '../../../common/upload/image-optimize.service';
import { AdminImageOptimizeService } from '../services/admin-image-optimize.service';
import { OptimizeImagesDto } from '../dto/admin-image-optimize.dto';

@Controller('admin/image-optimize')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN, UserRole.GODADMIN)
@RequirePermission('settings.update')
export class AdminImageOptimizeController {
  constructor(
    private readonly images: ImageOptimizeService,
    private readonly adminOptimize: AdminImageOptimizeService,
  ) {}

  @Get('profiles')
  profiles() {
    return this.images.getProfiles();
  }

  /**
   * سبک‌سازی تصاویر از قبل آپلودشده (listings / banners / brand).
   * آپلودهای جدید به‌صورت خودکار در همان مسیر آپلود بهینه می‌شوند.
   */
  @Post('run')
  async run(@Body() dto: OptimizeImagesDto) {
    const targets = dto.targets?.length
      ? dto.targets
      : (['banners', 'listings', 'brand'] as OptimizeTarget[]);
    const summaries = await this.images.optimizeTargets(targets, {
      limit: dto.limit,
      force: dto.force,
    });
    const remapped =
      dto.remapSettings === false
        ? { updated: 0 }
        : await this.adminOptimize.remapOptimizedFilenames(summaries);
    return { summaries, remapped };
  }
}
