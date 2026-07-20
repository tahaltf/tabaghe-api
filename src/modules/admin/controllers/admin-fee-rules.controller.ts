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
import { ListingType, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { AdminFeeRulesService } from '../services/admin-fee-rules.service';
import { CreateFeeRuleDto, UpdateFeeRuleDto } from '../dto/admin-fee-rule.dto';

@Controller('admin/fee-rules')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('fee_rules.view')
export class AdminFeeRulesController {
  constructor(private readonly service: AdminFeeRulesService) {}

  @Get()
  list(
    @Query('listingType') listingType?: ListingType,
    @Query('categoryId') categoryId?: string,
  ) {
    return this.service.list(listingType, categoryId);
  }

  @Post()
  @RequirePermission('fee_rules.create')
  create(@Body() dto: CreateFeeRuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('fee_rules.update')
  update(@Param('id') id: string, @Body() dto: UpdateFeeRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('fee_rules.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
