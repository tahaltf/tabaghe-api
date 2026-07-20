import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { RedisModule } from '../../infrastructure/cache/redis.module';
import {
  AdminMarketingController,
} from './controllers/admin-marketing.controller';
import {
  MarketingInstagramOAuthController,
  MarketingInstagramWebhookController,
} from './controllers/marketing-instagram-oauth.controller';
import { InstagramProvider } from './providers/instagram/instagram.provider';
import { InstagramOAuthService } from './providers/instagram/instagram-oauth.service';
import { InstagramWebhookService } from './providers/instagram/instagram-webhook.service';
import { MarketingTokenCryptoService } from './services/marketing-token-crypto.service';
import { MarketingAccountService } from './services/marketing-account.service';
import { MarketingMediaService } from './services/marketing-media.service';
import { MarketingPublishService } from './services/marketing-publish.service';
import { MarketingMessagingService } from './services/marketing-messaging.service';
import { MarketingInsightsService } from './services/marketing-insights.service';
import { MarketingSchedulerService } from './services/marketing-scheduler.service';

@Module({
  imports: [PrismaModule, RedisModule],
  controllers: [
    AdminMarketingController,
    MarketingInstagramOAuthController,
    MarketingInstagramWebhookController,
  ],
  providers: [
    MarketingTokenCryptoService,
    InstagramProvider,
    InstagramOAuthService,
    InstagramWebhookService,
    MarketingAccountService,
    MarketingMediaService,
    MarketingPublishService,
    MarketingMessagingService,
    MarketingInsightsService,
    MarketingSchedulerService,
  ],
  exports: [MarketingAccountService],
})
export class MarketingIntegrationModule {}
