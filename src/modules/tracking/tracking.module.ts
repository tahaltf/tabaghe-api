import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TrackingService } from './tracking.service';
import { AdminCampaignLinksService } from './admin-campaign-links.service';
import { AdminCampaignLinksController } from './admin-campaign-links.controller';
import { TrackingRedirectMiddleware } from './tracking-redirect.middleware';
import { CampaignPrefixService } from './campaign-prefix.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [AdminCampaignLinksController],
  providers: [
    TrackingService,
    AdminCampaignLinksService,
    TrackingRedirectMiddleware,
    CampaignPrefixService,
  ],
  exports: [TrackingService, CampaignPrefixService],
})
export class TrackingModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TrackingRedirectMiddleware).forRoutes({
      path: '*',
      method: RequestMethod.GET,
    });
  }
}
