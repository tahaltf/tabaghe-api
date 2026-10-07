import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ListingModule } from '../listing/listing.module';
import { UsersModule } from '../users/users.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { CurrencyModule } from '../currency/currency.module';
import { FeesModule } from '../fees/fees.module';
import { AdminWordPressPluginController } from './controllers/admin-wordpress-plugin.controller';
import { AdminWordPressSyncPolicyController } from './controllers/admin-wordpress-sync-policy.controller';
import { WordPressUserController } from './controllers/wordpress-user.controller';
import { WordPressIngestController } from './controllers/wordpress-ingest.controller';
import { WordPressPluginPublicController } from './controllers/wordpress-plugin-public.controller';
import { WordPressApiTokenService } from './services/api-token.service';
import { WordPressConnectionService } from './services/connection.service';
import { WordPressProductIngestService } from './services/product-ingest.service';
import { WordPressStoreSyncService } from './services/store-sync.service';
import { RemoteImageService } from './services/remote-image.service';
import { WordPressPluginPackageService } from './services/plugin-package.service';
import { WordPressCategoriesService } from './services/wordpress-categories.service';
import { WordPressSellerContextService } from './services/wordpress-seller-context.service';
import { ApiTokenGuard } from './guards/api-token.guard';

@Module({
  imports: [
    PrismaModule,
    NotificationModule,
    ListingModule,
    UsersModule,
    CurrencyModule,
    FeesModule,
  ],
  controllers: [
    WordPressUserController,
    WordPressIngestController,
    WordPressPluginPublicController,
    AdminWordPressPluginController,
    AdminWordPressSyncPolicyController,
  ],
  providers: [
    WordPressApiTokenService,
    WordPressConnectionService,
    WordPressProductIngestService,
    WordPressStoreSyncService,
    RemoteImageService,
    WordPressPluginPackageService,
    WordPressCategoriesService,
    WordPressSellerContextService,
    ApiTokenGuard,
  ],
  exports: [
    WordPressApiTokenService,
    WordPressConnectionService,
    RemoteImageService,
  ],
})
export class WordPressIntegrationModule {}
