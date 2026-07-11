import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { NotificationModule } from '../notification/notification.module';
import { AuthModule } from '../auth/auth.module';
import { SurveysService } from './surveys.service';
import { SurveysController } from './surveys.controller';
import { AdminSurveysController } from './admin-surveys.controller';
import { SurveysScheduler } from './surveys.scheduler';
import { SurveysListener } from './surveys.listener';

@Module({
  imports: [PrismaModule, NotificationModule, AuthModule],
  controllers: [SurveysController, AdminSurveysController],
  providers: [SurveysService, SurveysScheduler, SurveysListener],
  exports: [SurveysService],
})
export class SurveysModule {}
