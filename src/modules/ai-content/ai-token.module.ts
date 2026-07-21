import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { AiTokenService } from '../ai-content/services/ai-token.service';
import { AiContentSettingsService } from '../ai-content/services/ai-content-settings.service';
import { SettingsModule } from '../../shared/settings/settings.module';

@Module({
  imports: [PrismaModule, SettingsModule],
  providers: [AiTokenService, AiContentSettingsService],
  exports: [AiTokenService, AiContentSettingsService],
})
export class AiTokenModule {}
