import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../payments/payments.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartCheckoutService } from './cart-checkout.service';
import { MarketplaceCheckoutService } from './marketplace-checkout.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    forwardRef(() => OrdersModule),
    CouponsModule,
    PaymentsModule,
  ],
  controllers: [CartController],
  providers: [CartService, CartCheckoutService, MarketplaceCheckoutService],
  exports: [CartService, MarketplaceCheckoutService],
})
export class CartModule {}
