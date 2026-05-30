import { Module } from '@nestjs/common';
import { NotificationModule } from '../modules/notification/notification.module';
import { CommonController } from './common-module.controller';
import { PwaAssetsController } from './pwa-assets.controller';
import { CommonService } from './common-module.service';
import { PwaIconService } from './pwa-icon.service';

@Module({
  imports: [NotificationModule],
  controllers: [CommonController, PwaAssetsController],
  providers: [CommonService, PwaIconService],
  exports: [PwaIconService],
})
export class CommonModuleModule {}
