import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ListingAnalyticsService } from './listing-analytics.service';

@Controller('admin/analytics/listings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminListingAnalyticsController {
  constructor(private readonly analytics: ListingAnalyticsService) {}

  @Get()
  list() {
    return this.analytics.listListingStats();
  }

  @Get(':listingId/views')
  viewers(
    @Param('listingId') listingId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.listListingViewers(
      listingId,
      limit ? Number(limit) : 50,
    );
  }
}
