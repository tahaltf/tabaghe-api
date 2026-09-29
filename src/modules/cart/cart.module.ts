import { Module, forwardRef } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { OrdersModule } from '../orders/orders.module';
import { CouponsModule } from '../coupons/coupons.module';
import { PaymentsModule } from '../payments/payments.module';
import { FeesModule } from '../fees/fees.module';
import { PurchaseOfferModule } from '../purchase-offer/purchase-offer.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';
import { CartCheckoutService } from './cart-checkout.service';
import { MarketplaceCheckoutService } from './marketplace-checkout.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    FeesModule,
    forwardRef(() => OrdersModule),
    CouponsModule,
    PaymentsModule,
    PurchaseOfferModule,
  ],
  controllers: [CartController],
  providers: [CartService, CartCheckoutService, MarketplaceCheckoutService],
  exports: [CartService, MarketplaceCheckoutService],
})
export class CartModule {}
