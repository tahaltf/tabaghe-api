import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import {
  PruneDockerBuildCacheDto,
  PruneDockerImagesDto,
} from '../dto/admin-server-storage.dto';
import { AdminServerStorageService } from '../services/admin-server-storage.service';

@Controller('admin/server-storage')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.GODADMIN)
export class AdminServerStorageController {
  constructor(private readonly storage: AdminServerStorageService) {}

  @Get('overview')
  getOverview() {
    return this.storage.getOverview();
  }

  @Post('docker/prune-images')
  pruneDockerImages(@Body() dto: PruneDockerImagesDto) {
    return this.storage.pruneDockerImages(dto.confirmPhrase);
  }

  @Post('docker/prune-build-cache')
  pruneDockerBuildCache(@Body() dto: PruneDockerBuildCacheDto) {
    return this.storage.pruneDockerBuildCache(dto.confirmPhrase);
  }
}
