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
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminListingsQueryService } from '../services/admin-listings-query.service';
import { AdminListingDeleteService } from '../services/admin-listing-delete.service';
import {
  AdminListingListQueryDto,
  AdminSetListingStatusDto,
} from '../dto/admin-query.dto';
import { AdminBulkIdsDto } from '../dto/admin-bulk-ids.dto';

@Controller('admin/listings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminListingsQueryController {
  constructor(
    private readonly service: AdminListingsQueryService,
    private readonly listingDelete: AdminListingDeleteService,
  ) {}

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
  setStatus(@Param('id') id: string, @Body() dto: AdminSetListingStatusDto) {
    return this.service.setStatus(id, dto.status);
  }

  @Delete(':id/hard')
  @Roles(UserRole.GODADMIN)
  hardDelete(@Param('id') id: string) {
    return this.listingDelete.hardDeleteOne(id);
  }
}
