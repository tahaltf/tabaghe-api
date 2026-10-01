import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { QuotaModule } from '../quota/quota.module';
import { AuctionModule } from '../auction/auction.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { PurchaseOfferModule } from '../purchase-offer/purchase-offer.module';
import { NotificationModule } from '../notification/notification.module';
import { ListingController } from './listing.controller';
import { ListingAdminController } from './listing-admin.controller';
import { ListingSearchController } from './listing-search.controller';
import { ListingQueryService } from './services/listing-query.service';
import { ListingCommandService } from './services/listing-command.service';
import { ListingSavedService } from './services/listing-saved.service';
import { ListingAdminService } from './services/listing-admin.service';
import { ListingSearchService } from './listing-search.service';
import { ListingExpiryService } from './services/listing-expiry.service';
import { ListingMergeService } from './services/listing-merge.service';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CurrencyModule } from '../currency/currency.module';

@Module({
  imports: [
    PrismaModule,
    QuotaModule,
    AuctionModule,
    ExchangeModule,
    PurchaseOfferModule,
    NotificationModule,
    AnalyticsModule,
    AuthModule,
    UsersModule,
    CurrencyModule,
  ],
  controllers: [
    ListingController,
    ListingAdminController,
    ListingSearchController,
  ],
  providers: [
    ListingQueryService,
    ListingCommandService,
    ListingSavedService,
    ListingAdminService,
    ListingSearchService,
    ListingExpiryService,
    ListingMergeService,
  ],
  exports: [
    ListingQueryService,
    ListingCommandService,
    ListingExpiryService,
    ListingAdminService,
    ListingMergeService,
  ],
})
export class ListingModule {}
