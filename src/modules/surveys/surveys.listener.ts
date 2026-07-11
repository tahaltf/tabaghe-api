import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  OrderCompletedPayload,
  OrderEvents,
} from '../orders/order.events';
import { SurveysService } from './surveys.service';

@Injectable()
export class SurveysListener {
  private readonly logger = new Logger(SurveysListener.name);

  constructor(private readonly surveys: SurveysService) {}

  @OnEvent(OrderEvents.COMPLETED)
  async onOrderCompleted(payload: OrderCompletedPayload): Promise<void> {
    if (!payload?.orderId) return;
    try {
      await this.surveys.createForCompletedOrder(payload.orderId);
    } catch (err) {
      this.logger.warn(
        `createForCompletedOrder(${payload.orderId}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
