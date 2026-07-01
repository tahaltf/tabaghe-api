import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { ListingAnalyticsService } from './listing-analytics.service';
import { AdminListingAnalyticsController } from './admin-listing-analytics.controller';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminListingAnalyticsController],
  providers: [ListingAnalyticsService],
  exports: [ListingAnalyticsService],
})
export class AnalyticsModule {}
