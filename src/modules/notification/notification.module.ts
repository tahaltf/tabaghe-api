import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';
import { DeadlineReminderService } from './deadline-reminder.service';
import { NotificationListener } from './notification.listener';
import { NotificationController } from './notification.controller'; // 👈 اضافه شد
import { ConfigModule } from '@nestjs/config'; // 👈 اضافه شد برای کلید پیامک
import { SmsService } from '../sms/sms.service';
import { ExchangeOrderNotifyService } from './exchange-order-notify.service';

@Module({
  imports: [ConfigModule],
  controllers: [NotificationController], // 👈 اضافه شد
  providers: [
    PrismaService,
    SmsService,
    NotificationService,
    DeadlineReminderService,
    NotificationListener,
    ExchangeOrderNotifyService,
  ],
  exports: [NotificationService, ExchangeOrderNotifyService],
})
export class NotificationModule {}
