import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { PermissionsGuard } from '../../auth/guards/permissions.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { RequirePermission } from '../../auth/decorators/require-permission.decorator';
import { CurrencyService } from '../../currency/currency.service';
import {
  AdminSetCurrencyEnabledDto,
  AdminSetCurrencyRateOverrideDto,
} from '../../currency/dto/admin-currency.dto';

@Controller('admin/currencies')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard)
@Roles(UserRole.ADMIN)
@RequirePermission('settings.view')
export class AdminCurrenciesController {
  constructor(private readonly currency: CurrencyService) {}

  @Get()
  list() {
    return this.currency.listAllAdmin();
  }

  @Put(':code/enabled')
  @RequirePermission('settings.update')
  setEnabled(
    @Param('code') code: string,
    @Body() dto: AdminSetCurrencyEnabledDto,
  ) {
    return this.currency.setEnabled(code, dto.isEnabled);
  }

  @Put(':code/override')
  @RequirePermission('settings.update')
  setOverride(
    @Param('code') code: string,
    @Body() dto: AdminSetCurrencyRateOverrideDto,
  ) {
    return this.currency.setManualOverride(
      code,
      dto.rateToToman,
      dto.overrideUntil ? new Date(dto.overrideUntil) : null,
    );
  }

  @Delete(':code/override')
  @RequirePermission('settings.update')
  clearOverride(@Param('code') code: string) {
    return this.currency.clearManualOverride(code);
  }
}
