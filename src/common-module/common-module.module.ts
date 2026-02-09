import { Module } from '@nestjs/common';
import { CommonController } from './common-module.controller';
import { CommonService } from "./common-module.service";

@Module({
  controllers: [CommonController],
  providers: [CommonService],
})
export class CommonModuleModule {}
