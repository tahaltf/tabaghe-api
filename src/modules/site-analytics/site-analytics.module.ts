import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../../shared/settings/settings.module';
import { PageviewController } from './controllers/pageview.controller';
import { AdminSiteAnalyticsController } from './controllers/admin-site-analytics.controller';
import { SitePageviewService } from './services/site-pageview.service';
import { SiteAnalyticsRollupService } from './services/site-analytics-rollup.service';
import { SiteAnalyticsQueryService } from './services/site-analytics-query.service';
import { GscClientService } from './services/gsc-client.service';
import { GscSyncService } from './services/gsc-sync.service';
import { SiteAnalyticsIntelligenceService } from './services/site-analytics-intelligence.service';
import { SiteAnalyticsScheduler } from './schedulers/site-analytics.scheduler';

@Module({
  imports: [PrismaModule, AuthModule, SettingsModule],
  controllers: [PageviewController, AdminSiteAnalyticsController],
  providers: [
    SitePageviewService,
    SiteAnalyticsRollupService,
    SiteAnalyticsQueryService,
    GscClientService,
    GscSyncService,
    SiteAnalyticsIntelligenceService,
    SiteAnalyticsScheduler,
  ],
  exports: [SitePageviewService, SiteAnalyticsQueryService],
})
export class SiteAnalyticsModule {}
