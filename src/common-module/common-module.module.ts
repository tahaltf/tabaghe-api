import { Module } from '@nestjs/common';
import { NotificationModule } from '../modules/notification/notification.module';
import { CommonController } from './common-module.controller';
import { PwaAssetsController } from './pwa-assets.controller';
import { CommonService } from './common-module.service';
import { PwaIconService } from './pwa-icon.service';
import { CommonLocationService } from './services/common-location.service';
import { CommonCategoryService } from './services/common-category.service';
import { CommonContentService } from './services/common-content.service';
import { CommonEngagementService } from './services/common-engagement.service';
import { CommonPwaService } from './services/common-pwa.service';

@Module({
  imports: [NotificationModule],
  controllers: [CommonController, PwaAssetsController],
  providers: [
    CommonLocationService,
    CommonCategoryService,
    CommonContentService,
    CommonEngagementService,
    CommonPwaService,
    CommonService,
    PwaIconService,
  ],
  exports: [PwaIconService, CommonService],
})
export class CommonModuleModule {}
