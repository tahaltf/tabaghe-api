import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ZohalClient } from './zohal.client';
import { ZohalService } from './zohal.service';
import { ZohalSettingsService } from './zohal-settings.service';
import { InquiryRestrictionService } from './inquiry-restriction.service';

@Module({
  imports: [PrismaModule],
  providers: [ZohalClient, ZohalService, ZohalSettingsService, InquiryRestrictionService],
  exports: [ZohalService, ZohalSettingsService, InquiryRestrictionService],
})
export class ZohalModule {}
