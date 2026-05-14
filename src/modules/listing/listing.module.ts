import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { QuotaModule } from '../quota/quota.module';
import { AuctionModule } from '../auction/auction.module';
import { ExchangeModule } from '../exchange/exchange.module';
import { NotificationModule } from '../notification/notification.module';
import { ListingController } from './listing.controller';
import { ListingAdminController } from './listing-admin.controller';
import { ListingSearchController } from './listing-search.controller';
import { ListingQueryService } from './services/listing-query.service';
import { ListingCommandService } from './services/listing-command.service';
import { ListingSavedService } from './services/listing-saved.service';
import { ListingAdminService } from './services/listing-admin.service';
import { ListingSearchService } from './listing-search.service';

@Module({
  imports: [
    PrismaModule,
    QuotaModule,
    AuctionModule,
    ExchangeModule,
    NotificationModule,
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
  ],
  exports: [ListingQueryService],
})
export class ListingModule {}
