import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { IsVerifiedGuard } from '../auth/guards/is-verified.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../shared/contracts/auth';
import { CartService } from './cart.service';
import { CartCheckoutService } from './cart-checkout.service';
import {
  AddCartItemDto,
  CartCheckoutDto,
  CartCheckoutPreviewDto,
  UpdateCartItemDto,
} from './dto/cart.dto';
import { extractClientRequestMeta } from '../../common/http/client-ip.util';

@Controller('cart')
@UseGuards(JwtAuthGuard)
export class CartController {
  constructor(
    private readonly cartService: CartService,
    private readonly cartCheckout: CartCheckoutService,
  ) {}

  @Get()
  getCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartService.getCart(user.id);
  }

  @Post('items')
  addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.addItem(
      user.id,
      dto.listingId,
      dto.quantity ?? 1,
    );
  }

  @Patch('items/:listingId')
  updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
    @Body() dto: UpdateCartItemDto,
  ) {
    return this.cartService.updateItemQuantity(
      user.id,
      listingId,
      dto.quantity,
    );
  }

  @Delete('items/:listingId')
  removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('listingId') listingId: string,
  ) {
    return this.cartService.removeItem(user.id, listingId);
  }

  @Delete()
  clearCart(@CurrentUser() user: AuthenticatedUser) {
    return this.cartService.clearCart(user.id);
  }

  @Post('checkout-preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CartCheckoutPreviewDto,
  ) {
    return this.cartCheckout.preview(user.id, dto);
  }

  @Post('checkout')
  @UseGuards(IsVerifiedGuard)
  checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CartCheckoutDto,
    @Req() req: Request,
  ) {
    return this.cartCheckout.checkout(
      user.id,
      dto,
      extractClientRequestMeta(req),
    );
  }
}
