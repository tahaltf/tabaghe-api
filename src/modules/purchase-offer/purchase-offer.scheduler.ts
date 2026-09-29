import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PurchaseOfferService } from './purchase-offer.service';

@Injectable()
export class PurchaseOfferScheduler {
  private readonly logger = new Logger(PurchaseOfferScheduler.name);

  constructor(private readonly purchaseOfferService: PurchaseOfferService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async handleExpirations() {
    try {
      await this.purchaseOfferService.expirePendingOffers();
      await this.purchaseOfferService.expireAcceptedReservations();
    } catch (err) {
      this.logger.error(
        'Failed to process purchase offer expirations',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }
}
