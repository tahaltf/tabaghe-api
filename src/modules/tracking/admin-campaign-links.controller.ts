import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { AdminCampaignLinksService } from './admin-campaign-links.service';
import { TrackingService } from './tracking.service';
import {
  CampaignLinkStatsQueryDto,
  CreateCampaignLinkDto,
  UpdateCampaignLinkDto,
} from './dto/campaign-link.dto';

@Controller('admin/campaign-links')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('campaign_links.view')
export class AdminCampaignLinksController {
  constructor(
    private readonly service: AdminCampaignLinksService,
    private readonly tracking: TrackingService,
  ) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Get(':id/stats/hourly')
  hourlyStats(
    @Param('id') id: string,
    @Query() query: CampaignLinkStatsQueryDto,
  ) {
    return this.tracking.getHourlyClickStats(id, query.days ?? 7);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermission('campaign_links.create')
  create(
    @Body() dto: CreateCampaignLinkDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.service.create(dto, actor.id);
  }

  @Patch(':id')
  @RequirePermission('campaign_links.update')
  update(@Param('id') id: string, @Body() dto: UpdateCampaignLinkDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('campaign_links.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
