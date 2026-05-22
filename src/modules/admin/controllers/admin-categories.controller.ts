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
import { AdminCategoriesService } from '../services/admin-categories.service';
import {
  CreateCategoryDto,
  SetCategoryActiveDto,
  UpdateCategoryDto,
} from '../dto/admin-category.dto';
import { AdminBulkIdsDto } from '../dto/admin-bulk-ids.dto';

@Controller('admin/categories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
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
  create(@Body() dto: CreateCategoryDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.service.update(id, dto);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: SetCategoryActiveDto) {
    return this.service.setActive(id, dto);
  }

  @Post('bulk-force-delete')
  @Roles(UserRole.GODADMIN)
  bulkForceRemove(@Body() dto: AdminBulkIdsDto) {
    return this.service.forceRemoveMany(dto.ids);
  }

  @Delete(':id/force')
  @Roles(UserRole.GODADMIN)
  forceRemove(@Param('id') id: string) {
    return this.service.forceRemove(id);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
