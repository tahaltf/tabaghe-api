import { Module } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationListener } from './notification.listener';
import { NotificationController } from './notification.controller'; // 👈 اضافه شد
import { ConfigModule } from '@nestjs/config'; // 👈 اضافه شد برای کلید پیامک
import { SmsService } from '../sms/sms.service';

@Module({
    imports: [ConfigModule],
    controllers: [NotificationController], // 👈 اضافه شد
    providers: [
        PrismaService,
        SmsService,
        NotificationService,
        NotificationListener,
    ],
    exports: [NotificationService]
})
export class NotificationModule {}