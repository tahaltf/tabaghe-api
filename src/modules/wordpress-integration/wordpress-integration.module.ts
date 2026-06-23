import { Module } from '@nestjs/common';
import { NotificationModule } from '../notification/notification.module';
import { AdminWordPressPluginController } from './controllers/admin-wordpress-plugin.controller';
import { WordPressUserController } from './controllers/wordpress-user.controller';
import { WordPressIngestController } from './controllers/wordpress-ingest.controller';
import { WordPressApiTokenService } from './services/api-token.service';
import { WordPressConnectionService } from './services/connection.service';
import { WordPressProductIngestService } from './services/product-ingest.service';
import { RemoteImageService } from './services/remote-image.service';
import { WordPressPluginPackageService } from './services/plugin-package.service';
import { ApiTokenGuard } from './guards/api-token.guard';

@Module({
  imports: [NotificationModule],
  controllers: [
    WordPressUserController,
    WordPressIngestController,
    AdminWordPressPluginController,
  ],
  providers: [
    WordPressApiTokenService,
    WordPressConnectionService,
    WordPressProductIngestService,
    RemoteImageService,
    WordPressPluginPackageService,
    ApiTokenGuard,
  ],
  exports: [WordPressApiTokenService, WordPressConnectionService],
})
export class WordPressIntegrationModule {}
