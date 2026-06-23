import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { ListingModule } from '../listing/listing.module';
import { AdminWordPressPluginController } from './controllers/admin-wordpress-plugin.controller';
import { WordPressUserController } from './controllers/wordpress-user.controller';
import { WordPressIngestController } from './controllers/wordpress-ingest.controller';
import { WordPressApiTokenService } from './services/api-token.service';
import { WordPressConnectionService } from './services/connection.service';
import { WordPressProductIngestService } from './services/product-ingest.service';
import { WordPressStoreSyncService } from './services/store-sync.service';
import { RemoteImageService } from './services/remote-image.service';
import { WordPressPluginPackageService } from './services/plugin-package.service';
import { WordPressCategoriesService } from './services/wordpress-categories.service';
import { ApiTokenGuard } from './guards/api-token.guard';

@Module({
  imports: [NotificationModule, ListingModule],
  controllers: [
    WordPressUserController,
    WordPressIngestController,
    AdminWordPressPluginController,
  ],
  providers: [
    WordPressApiTokenService,
    WordPressConnectionService,
    WordPressProductIngestService,
    WordPressStoreSyncService,
    RemoteImageService,
    WordPressPluginPackageService,
    WordPressCategoriesService,
    ApiTokenGuard,
  ],
  exports: [WordPressApiTokenService, WordPressConnectionService],
})
export class WordPressIntegrationModule {}
