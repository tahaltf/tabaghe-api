import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { CouponsService } from './coupons.service';
import {
  ValidateCouponDto,
  ValidateSingleOrderCouponDto,
} from './dto/coupon.dto';

@Controller('coupons')
@UseGuards(JwtAuthGuard)
export class CouponsController {
  constructor(private readonly couponsService: CouponsService) {}

  @Post('validate')
  async validate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValidateCouponDto,
  ) {
    if (dto.items?.length) {
      return this.couponsService.validateForCart(
        user.id,
        dto.code,
        dto.items,
      );
    }
    if (dto.listingId) {
      return this.couponsService.validateForSingleOrder(
        user.id,
        dto.code,
        dto.listingId,
        dto.quantity ?? 1,
      );
    }
    throw new BadRequestException('اطلاعات سبد یا آگهی لازم است');
  }

  @Post('validate-order')
  validateOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ValidateSingleOrderCouponDto,
  ) {
    return this.couponsService.validateForSingleOrder(
      user.id,
      dto.code,
      dto.listingId,
      dto.quantity ?? 1,
    );
  }
}
