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
import { Roles } from '../../auth/decorators/roles.decorator';
import { AdminFeeRulesService } from '../services/admin-fee-rules.service';
import { CreateFeeRuleDto, UpdateFeeRuleDto } from '../dto/admin-fee-rule.dto';

@Controller('admin/fee-rules')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
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
  create(@Body() dto: CreateFeeRuleDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFeeRuleDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
