import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ListingMergeRequestStatus, UserRole } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { ListingMergeService } from '../../listing/services/listing-merge.service';
import {
  AdminApproveMergeRequestDto,
  AdminDirectMergeDto,
  AdminRejectMergeRequestDto,
} from '../../listing/dto/admin-merge.dto';

class AdminMergeRequestsQueryDto {
  @IsOptional()
  @IsEnum(ListingMergeRequestStatus)
  status?: ListingMergeRequestStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number;
}

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
export class AdminListingMergeController {
  constructor(private readonly mergeService: ListingMergeService) {}

  @Get('listing-merge-requests/pending-count')
  @RequirePermission('listings.view')
  pendingCount() {
    return this.mergeService.countPendingRequests().then((count) => ({ count }));
  }

  @Get('listing-merge-requests')
  @RequirePermission('listings.view')
  list(@Query() query: AdminMergeRequestsQueryDto) {
    return this.mergeService.listAdminRequests({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Post('listing-merge-requests/:id/approve')
  @RequirePermission('listings.approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdminApproveMergeRequestDto,
  ) {
    return this.mergeService.approveRequest(
      user.id,
      id,
      dto.targetListingId,
      dto.adminNote,
    );
  }

  @Post('listing-merge-requests/:id/reject')
  @RequirePermission('listings.approve')
  reject(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdminRejectMergeRequestDto,
  ) {
    return this.mergeService.rejectRequest(user.id, id, dto.adminNote);
  }

  @Post('listings/merge')
  @RequirePermission('listings.update')
  directMerge(@Body() dto: AdminDirectMergeDto) {
    return this.mergeService.mergeListings(dto.listingIds, dto.targetListingId);
  }

  @Post('listings/:id/unmerge')
  @RequirePermission('listings.update')
  unmerge(@Param('id') id: string) {
    return this.mergeService.unmergeListing(id);
  }
}
