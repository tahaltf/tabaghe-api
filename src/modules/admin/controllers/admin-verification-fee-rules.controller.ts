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
import { AdminVerificationFeeRulesService } from '../services/admin-verification-fee-rules.service';
import {
  CreateVerificationFeeRuleDto,
  UpdateVerificationFeeRuleDto,
} from '../dto/admin-verification-fee-rule.dto';

@Controller('admin/verification-fee-rules')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('verification_fee_rules.view')
export class AdminVerificationFeeRulesController {
  constructor(private readonly service: AdminVerificationFeeRulesService) {}

  @Get()
  list(@Query('categoryId') categoryId?: string) {
    return this.service.list(categoryId);
  }

  @Post()
  @RequirePermission('verification_fee_rules.create')
  create(@Body() dto: CreateVerificationFeeRuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermission('verification_fee_rules.update')
  update(@Param('id') id: string, @Body() dto: UpdateVerificationFeeRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermission('verification_fee_rules.delete')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
