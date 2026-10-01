import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CurrencyService } from './currency.service';
import { FxIngestGuard } from './guards/fx-ingest.guard';
import { FxIngestRatesDto } from './dto/fx-ingest.dto';

/**
 * Endpoint برای n8n / اتوماسیون خارجی.
 * Auth: header `X-Fx-Ingest-Key` یا `Authorization: Bearer <FX_INGEST_SECRET>`
 */
@Controller('integrations/fx-rates')
@UseGuards(FxIngestGuard)
export class FxIngestController {
  constructor(private readonly currency: CurrencyService) {}

  @Post()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  ingest(@Body() dto: FxIngestRatesDto) {
    return this.currency.ingestRates(dto);
  }
}
