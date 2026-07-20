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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminListingsQueryService } from '../services/admin-listings-query.service';
import { AdminListingDeleteService } from '../services/admin-listing-delete.service';
import {
  AdminListingListQueryDto,
  AdminSetListingFeaturedDto,
  AdminSetListingStatusDto,
} from '../dto/admin-query.dto';
import { AdminBulkIdsDto } from '../dto/admin-bulk-ids.dto';
import { AdminBulkRejectDto } from '../dto/admin-bulk-reject.dto';
import { ListingAdminService } from '../../listing/services/listing-admin.service';

@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('listings.view')
export class AdminListingsQueryController {
  constructor(
    private readonly service: AdminListingsQueryService,
    private readonly listingDelete: AdminListingDeleteService,
    private readonly listingAdmin: ListingAdminService,
  ) {}

  @Post('bulk-approve')
  @RequirePermission('listings.approve')
  bulkApprove(@Body() dto: AdminBulkIdsDto) {
    return this.listingAdmin.approveMany(dto.ids);
  }

  @Post('bulk-reject')
  @RequirePermission('listings.approve')
  bulkReject(@Body() dto: AdminBulkRejectDto) {
    return this.listingAdmin.rejectMany(dto.ids, dto.rejectionReason);
  }

  @Post('bulk-delete')
  @Roles(UserRole.GODADMIN)
  bulkHardDelete(@Body() dto: AdminBulkIdsDto) {
    return this.listingDelete.hardDeleteMany(dto.ids);
  }

  @Get('paginated')
  list(@Query() query: AdminListingListQueryDto) {
    return this.service.list(query);
  }

  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id/status')
  @RequirePermission('listings.update')
  setStatus(@Param('id') id: string, @Body() dto: AdminSetListingStatusDto) {
    return this.service.setStatus(id, dto.status);
  }

  @Patch(':id/featured')
  @RequirePermission('listings.update')
  setFeatured(
    @Param('id') id: string,
    @Body() dto: AdminSetListingFeaturedDto,
  ) {
    return this.service.setFeatured(id, dto.isFeatured);
  }

  @Delete(':id/hard')
  @Roles(UserRole.GODADMIN)
  hardDelete(@Param('id') id: string) {
    return this.listingDelete.hardDeleteOne(id);
  }
}
