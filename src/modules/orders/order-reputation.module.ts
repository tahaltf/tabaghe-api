import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { UserRatingHistoryService } from '../users/user-rating-history.service';
import { OrderReputationService } from './order-reputation.service';

/** جدا از OrdersModule تا AuctionModule بدون وابستگی دایره‌ای به ListingModule بالا بیاید. */
@Module({
  imports: [PrismaModule],
  providers: [OrderReputationService, UserRatingHistoryService],
  exports: [OrderReputationService],
})
export class OrderReputationModule {}
