import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ListingStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { ListingAdminService } from './services/listing-admin.service';
import { RejectListingDto } from './dto/reject-listing.dto';
import { SetListingStatusDto } from './dto/set-listing-status.dto';
import { AdminListingCorrectionsDto } from './dto/admin-listing-corrections.dto';
import { AdminListingUpdateDto } from './dto/admin-listing-update.dto';

@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('listings.view')
export class ListingAdminController {
  constructor(private readonly adminService: ListingAdminService) {}

  @Get()
  findAll(@Query('status') status?: ListingStatus) {
    return this.adminService.listAll(status);
  }

  @Patch(':id/corrections')
  @RequirePermission('listings.update')
  applyCorrections(
    @Param('id') id: string,
    @Body() dto: AdminListingCorrectionsDto,
  ) {
    return this.adminService.applyCorrections(id, dto);
  }

  @Patch(':id/update')
  @RequirePermission('listings.update')
  applyAdminUpdate(
    @Param('id') id: string,
    @Body() dto: AdminListingUpdateDto,
  ) {
    return this.adminService.applyAdminUpdate(id, dto);
  }

  @Patch(':id/approve')
  @RequirePermission('listings.approve')
  approve(@Param('id') id: string, @Body() dto: AdminListingCorrectionsDto) {
    return this.adminService.approve(id, dto);
  }

  @Patch(':id/reject')
  @RequirePermission('listings.approve')
  reject(@Param('id') id: string, @Body() dto: RejectListingDto) {
    return this.adminService.reject(id, dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetListingStatusDto) {
    return this.adminService.setStatus(id, dto.status);
  }
}
