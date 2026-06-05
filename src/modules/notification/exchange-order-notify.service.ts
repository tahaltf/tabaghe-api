import { Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
import { OperationalNotifyService } from './operational-notify.service';

type ExchangeOrderParties = {
  id: string;
  buyerId: string;
  sellerId: string;
  listingId: string;
};

/** نازک‌نگهدار روی OperationalNotifyService — مسیر واحد نوتیف/پیامک معاوضه */
@Injectable()
export class ExchangeOrderNotifyService {
  constructor(private readonly operationalNotify: OperationalNotifyService) {}

  notifyReadyToShip(order: ExchangeOrderParties): Promise<void> {
    return this.operationalNotify.notifyExchangeReadyToShip(order);
  }

  notifyParticipantPaid(
    order: ExchangeOrderParties,
    payerUserId: string,
  ): Promise<void> {
    return this.operationalNotify.notifyExchangeParticipantPaid(
      order,
      payerUserId,
    );
  }

  afterShipmentUpdated(
    order: {
      id: string;
      buyerId: string;
      sellerId: string;
      listingId: string;
      status: OrderStatus;
      trackingCode: string | null;
      sellerTrackingCode: string | null;
    },
    shipperUserId: string,
  ): Promise<void> {
    return this.operationalNotify.afterExchangeShipmentUpdated(
      order,
      shipperUserId,
    );
  }
}
