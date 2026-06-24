import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { NotificationModule } from '../notification/notification.module';
import { TicketAttachmentSettingsService } from './ticket-attachment-settings.service';

@Module({
  imports: [NotificationModule],
  controllers: [SupportController],
  providers: [SupportService, PrismaService, TicketAttachmentSettingsService],
  exports: [TicketAttachmentSettingsService],
})
export class SupportModule {}
