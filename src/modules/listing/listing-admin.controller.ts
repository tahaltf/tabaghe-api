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
import { Roles } from '../auth/decorators/roles.decorator';
import { ListingAdminService } from './services/listing-admin.service';
import { RejectListingDto } from './dto/reject-listing.dto';
import { SetListingStatusDto } from './dto/set-listing-status.dto';
import { AdminListingCorrectionsDto } from './dto/admin-listing-corrections.dto';

@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class ListingAdminController {
  constructor(private readonly adminService: ListingAdminService) {}

  @Get()
  findAll(@Query('status') status?: ListingStatus) {
    return this.adminService.listAll(status);
  }

  @Patch(':id/corrections')
  applyCorrections(
    @Param('id') id: string,
    @Body() dto: AdminListingCorrectionsDto,
  ) {
    return this.adminService.applyCorrections(id, dto);
  }

  @Patch(':id/approve')
  approve(@Param('id') id: string, @Body() dto: AdminListingCorrectionsDto) {
    return this.adminService.approve(id, dto);
  }

  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectListingDto) {
    return this.adminService.reject(id, dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetListingStatusDto) {
    return this.adminService.setStatus(id, dto.status);
  }
}
