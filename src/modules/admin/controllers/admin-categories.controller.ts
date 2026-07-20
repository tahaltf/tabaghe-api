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
import { AdminCategoriesService } from '../services/admin-categories.service';
import {
  CreateCategoryDto,
  SetCategoryActiveDto,
  UpdateCategoryDto,
} from '../dto/admin-category.dto';
import { AdminBulkIdsDto } from '../dto/admin-bulk-ids.dto';

@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('categories.view')
export class AdminCategoriesController {
  constructor(private readonly service: AdminCategoriesService) {}

  @Get()
  list(@Query('search') search?: string) {
    return this.service.list(search);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Post()
  @RequirePermission('categories.create')
  create(@Body() dto: CreateCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('categories.update')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/active')
  @RequirePermission('categories.update')
  setActive(@Param('id') id: string, @Body() dto: SetCategoryActiveDto) {
    return this.service.setActive(id, dto);
  }

  @Post('bulk-force-delete')
  @RequirePermission('categories.delete')
  @Roles(UserRole.GODADMIN)
  bulkForceRemove(@Body() dto: AdminBulkIdsDto) {
    return this.service.forceRemoveMany(dto.ids);
  }

  @Delete(':id/force')
  @RequirePermission('categories.delete')
  @Roles(UserRole.GODADMIN)
  forceRemove(@Param('id') id: string) {
    return this.service.forceRemove(id);
  }

  @Delete(':id')
  @RequirePermission('categories.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
