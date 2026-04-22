import { BadRequestException, Injectable } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PENDING]: [OrderStatus.AWAITING_PAYMENT, OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.AWAITING_PAYMENT]: [OrderStatus.PAID, OrderStatus.CANCELLED],
  [OrderStatus.PAID]: [OrderStatus.AWAITING_SHIPMENT_TO_HUB, OrderStatus.SHIPPED, OrderStatus.CANCELLED],
  [OrderStatus.AWAITING_SHIPMENT_TO_HUB]: [OrderStatus.SHIPPED_TO_HUB, OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED_TO_HUB]: [OrderStatus.RECEIVED_AT_HUB, OrderStatus.CANCELLED],
  [OrderStatus.RECEIVED_AT_HUB]: [OrderStatus.CHECKING_AT_HUB, OrderStatus.REJECTED_AT_HUB],
  [OrderStatus.CHECKING_AT_HUB]: [OrderStatus.VERIFIED_AT_HUB, OrderStatus.REJECTED_AT_HUB],
  [OrderStatus.VERIFIED_AT_HUB]: [OrderStatus.SHIPPED_TO_BUYER],
  [OrderStatus.REJECTED_AT_HUB]: [OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED_TO_BUYER]: [OrderStatus.SHIPPED, OrderStatus.DELIVERED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED, OrderStatus.DISPUTED, OrderStatus.COMPLETED],
  [OrderStatus.DELIVERED]: [OrderStatus.DISPUTED, OrderStatus.COMPLETED],
  [OrderStatus.DISPUTED]: [OrderStatus.COMPLETED, OrderStatus.CANCELLED],
  [OrderStatus.COMPLETED]: [],
  [OrderStatus.CANCELLED]: [],
};

@Injectable()
export class OrdersStateMachineService {
  canTransition(from: OrderStatus, to: OrderStatus): boolean {
    if (from === to) return true;
    return TRANSITIONS[from]?.includes(to) ?? false;
  }

  assertTransition(from: OrderStatus, to: OrderStatus, action: string): void {
    if (!this.canTransition(from, to)) {
      throw new BadRequestException(`تغییر وضعیت نامعتبر است: ${from} -> ${to} (${action})`);
    }
  }
}
