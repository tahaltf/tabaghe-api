import { Module } from '@nestjs/common';
import { ZohalClient } from './zohal.client';
import { ZohalService } from './zohal.service';
import { ZohalSettingsService } from './zohal-settings.service';

@Module({
  providers: [ZohalClient, ZohalService, ZohalSettingsService],
  exports: [ZohalService, ZohalSettingsService],
})
export class ZohalModule {}
