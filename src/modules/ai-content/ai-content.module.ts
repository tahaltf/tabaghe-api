import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { WalletModule } from '../wallet/wallet.module';
import { SettingsModule } from '../../shared/settings/settings.module';
import { AdminAiContentController } from './controllers/admin-ai-content.controller';
import { AiContentController } from './controllers/ai-content.controller';
import { OpenAiImageProvider } from './providers/openai-image.provider';
import { OpenAiTextProvider } from './providers/openai-text.provider';
import { AiContentSettingsService } from './services/ai-content-settings.service';
import { AiContentStoryService } from './services/ai-content-story.service';
import { AiTokenPurchaseService } from './services/ai-token-purchase.service';
import { AiTokenService } from './services/ai-token.service';

@Module({
  imports: [PrismaModule, WalletModule, SettingsModule],
  controllers: [AiContentController, AdminAiContentController],
  providers: [
    AiContentSettingsService,
    AiTokenService,
    AiTokenPurchaseService,
    AiContentStoryService,
    OpenAiTextProvider,
    OpenAiImageProvider,
  ],
  exports: [AiTokenService, AiContentSettingsService],
})
export class AiContentModule {}
