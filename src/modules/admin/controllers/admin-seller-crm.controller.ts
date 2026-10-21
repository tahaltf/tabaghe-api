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
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../../shared/contracts/auth';
import { AdminSellerCrmService } from '../services/admin-seller-crm.service';
import {
  AdminChangeSellerLeadStageDto,
  AdminConvertSellerLeadDto,
  AdminCreateSellerLeadActivityDto,
  AdminCreateSellerLeadDto,
  AdminImportSellerLeadsDto,
  AdminSellerLeadListQueryDto,
  AdminSellerLeadSmsDto,
  AdminUpdateSellerLeadDto,
} from '../dto/admin-seller-crm.dto';

@Controller('admin/seller-crm')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('seller_crm.view')
export class AdminSellerCrmController {
  constructor(private readonly service: AdminSellerCrmService) {}

  @Get()
  list(@Query() query: AdminSellerLeadListQueryDto) {
    return this.service.list(query);
  }

  @Get('board')
  board() {
    return this.service.board();
  }

  @Get('stats')
  stats() {
    return this.service.stats();
  }

  @Post()
  @RequirePermission('seller_crm.create')
  create(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AdminCreateSellerLeadDto,
  ) {
    return this.service.create(actor.id, dto);
  }

  @Post('import')
  @RequirePermission('seller_crm.create')
  importCsv(
    @CurrentUser() actor: AuthenticatedUser,
    @Body() dto: AdminImportSellerLeadsDto,
  ) {
    return this.service.importCsv(actor.id, dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.service.detail(id);
  }

  @Patch(':id')
  @RequirePermission('seller_crm.update')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminUpdateSellerLeadDto,
  ) {
    return this.service.update(actor.id, id, dto);
  }

  @Post(':id/stage')
  @RequirePermission('seller_crm.update')
  changeStage(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminChangeSellerLeadStageDto,
  ) {
    return this.service.changeStage(actor.id, id, dto);
  }

  @Post(':id/activities')
  @RequirePermission('seller_crm.update')
  addActivity(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCreateSellerLeadActivityDto,
  ) {
    return this.service.addActivity(actor.id, id, dto);
  }

  @Post(':id/sms')
  @RequirePermission('seller_crm.update')
  sendSms(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminSellerLeadSmsDto,
  ) {
    return this.service.sendSms(actor.id, id, dto);
  }

  @Post(':id/convert')
  @RequirePermission('seller_crm.update')
  convert(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminConvertSellerLeadDto,
  ) {
    return this.service.convert(actor.id, id, dto);
  }

  @Delete(':id')
  @RequirePermission('seller_crm.delete')
  remove(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.service.remove(actor.id, id);
  }
}
