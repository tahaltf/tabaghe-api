import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CouponsService } from './coupons.service';
import { CouponsController } from './coupons.controller';
import { AdminCouponsController } from './admin-coupons.controller';
import { SellerCouponsController } from './seller-coupons.controller';

@Module({
  imports: [PrismaModule, AuthModule, UsersModule],
  controllers: [
    CouponsController,
    AdminCouponsController,
    SellerCouponsController,
  ],
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}
