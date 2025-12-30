import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { NotificationListener } from './notification.listener';

@Module({
    providers: [
        PrismaService,
        NotificationService,
        NotificationListener,
    ],
})
export class NotificationModule {}
