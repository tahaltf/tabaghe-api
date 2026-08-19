import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ZohalClient } from './zohal.client';
import { ZohalService } from './zohal.service';
import { ZohalSettingsService } from './zohal-settings.service';

@Module({
  imports: [PrismaModule],
  providers: [ZohalClient, ZohalService, ZohalSettingsService],
  exports: [ZohalService, ZohalSettingsService],
})
export class ZohalModule {}
