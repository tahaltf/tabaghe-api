import { Controller, Get } from '@nestjs/common';
import { CurrencyService } from './currency.service';

@Controller('currencies')
export class CurrencyController {
  constructor(private readonly currency: CurrencyService) {}

  @Get()
  listEnabled() {
    return this.currency.listPublicEnabled();
  }

  @Get('rates')
  async rates() {
    const list = await this.currency.listPublicEnabled();
    return list.map((c) => ({
      code: c.code,
      rateToToman: c.rateToToman,
      updatedAt: c.rateUpdatedAt,
      source: c.rateSource,
    }));
  }
}
