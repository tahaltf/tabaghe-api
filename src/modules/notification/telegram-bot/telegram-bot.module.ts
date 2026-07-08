import { Module } from '@nestjs/common';

import { PrismaModule } from '../../../infrastructure/prisma/prisma.module';
import { ListingModule } from '../../listing/listing.module';
import { TelegramBotService } from './telegram-bot.service';

@Module({
  imports: [PrismaModule, ListingModule],
  providers: [TelegramBotService],
  exports: [TelegramBotService],
})
export class TelegramBotModule {}

