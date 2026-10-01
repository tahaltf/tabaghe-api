import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CurrencyModule } from '../currency/currency.module';
import { ListingModule } from '../listing/listing.module';
import { NotificationModule } from '../notification/notification.module';
import { WordPressIntegrationModule } from '../wordpress-integration/wordpress-integration.module';
import { AdminProductFeedController } from './controllers/admin-product-feed.controller';
import { ProductFeedConfigService } from './services/product-feed-config.service';
import { ProductFeedIngestService } from './services/product-feed-ingest.service';
import { ProductFeedSchedulerService } from './services/product-feed-scheduler.service';
import { ProductFeedSyncService } from './services/product-feed-sync.service';

@Module({
  imports: [
    PrismaModule,
    CurrencyModule,
    ListingModule,
    NotificationModule,
    WordPressIntegrationModule,
  ],
  controllers: [AdminProductFeedController],
  providers: [
    ProductFeedConfigService,
    ProductFeedIngestService,
    ProductFeedSyncService,
    ProductFeedSchedulerService,
  ],
  exports: [ProductFeedConfigService, ProductFeedSyncService],
})
export class ProductFeedModule {}
