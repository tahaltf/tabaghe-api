import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { SettingsModule } from '../../shared/settings/settings.module';
import { CurrencyService } from './currency.service';
import { CurrencyController } from './currency.controller';
import { FxIngestController } from './fx-ingest.controller';
import { FxIngestGuard } from './guards/fx-ingest.guard';

@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [CurrencyController, FxIngestController],
  providers: [CurrencyService, FxIngestGuard],
  exports: [CurrencyService],
})
export class CurrencyModule {}
