import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';
import { DeadlineReminderService } from './deadline-reminder.service';
import { NotificationListener } from './notification.listener';
import { NotificationController } from './notification.controller'; // 👈 اضافه شد
import { ConfigModule } from '@nestjs/config'; // 👈 اضافه شد برای کلید پیامک
import { SmsModule } from '../sms/sms.module';
import { OperationalNotifyService } from './operational-notify.service';
import { ExchangeOrderNotifyService } from './exchange-order-notify.service';
import { ListingNotificationBatchService } from '../../common/notification/listing-notification-batch.service';

@Module({
  imports: [ConfigModule, SmsModule],
  controllers: [NotificationController], // 👈 اضافه شد
  providers: [
    PrismaService,
    NotificationService,
    DeadlineReminderService,
    NotificationListener,
    OperationalNotifyService,
    ExchangeOrderNotifyService,
    ListingNotificationBatchService,
  ],
  exports: [
    NotificationService,
    OperationalNotifyService,
    ExchangeOrderNotifyService,
    ListingNotificationBatchService,
  ],
})
export class NotificationModule {}
