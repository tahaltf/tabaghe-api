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
import { LocationType, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminLocationsService } from '../services/admin-locations.service';
import {
  CreateLocationDto,
  UpdateLocationDto,
} from '../dto/admin-location.dto';

@Controller('admin/locations')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('locations.view')
export class AdminLocationsController {
  constructor(private readonly service: AdminLocationsService) {}

  @Get()
  list(@Query('type') type?: LocationType, @Query('search') search?: string) {
    return this.service.list(type, search);
  }

  @Post()
  @RequirePermission('locations.create')
  create(@Body() dto: CreateLocationDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('locations.update')
  update(@Param('id') id: string, @Body() dto: UpdateLocationDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('locations.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
