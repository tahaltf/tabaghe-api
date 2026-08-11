import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserPanelAccessGuard } from '../auth/guards/user-panel-access.guard';
import { RequirePanelAccess } from '../auth/decorators/require-panel-access.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { CouponsService } from './coupons.service';
import { CreateCouponDto, UpdateCouponDto } from './dto/coupon.dto';

@Controller('seller/coupons')
@UseGuards(JwtAuthGuard, UserPanelAccessGuard)
@RequirePanelAccess('dashboard.marketing')
export class SellerCouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.couponsService.listForSeller(user.id);
  }

  @Get('scope-options')
  scopeOptions(@CurrentUser() user: AuthenticatedUser) {
    return this.couponsService.getSellerScopeOptions(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateCouponDto,
  ) {
    return this.couponsService.createForSeller(user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateCouponDto,
  ) {
    return this.couponsService.updateForSeller(user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.couponsService.deleteForSeller(user.id, id);
  }
}
