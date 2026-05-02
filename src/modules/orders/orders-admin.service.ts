import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OrdersStateMachineService } from './orders-state-machine.service';

const HUB_ACTIVE_STATUSES: OrderStatus[] = [
  OrderStatus.AWAITING_SHIPMENT_TO_HUB,
  OrderStatus.RECEIVED_AT_HUB,
  OrderStatus.CHECKING_AT_HUB,
  OrderStatus.VERIFIED_AT_HUB,
];

@Injectable()
export class OrdersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stateMachine: OrdersStateMachineService,
  ) {}

  async updateHubStatus(
    orderId: string,
    nextStatus: OrderStatus,
    hubToBuyerTrackingCode?: string,
    hubToSellerTrackingCode?: string,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException('سفارش یافت نشد');

    this.stateMachine.assertTransition(order.status, nextStatus, 'admin-hub-update');

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        ...(hubToBuyerTrackingCode && { hubToBuyerTrackingCode }),
        ...(hubToSellerTrackingCode && { hubToSellerTrackingCode }),
      },
    });
  }

  getHubOrders() {
    return this.prisma.order.findMany({
      where: {
        status: { in: HUB_ACTIVE_STATUSES },
      },
      include: {
        listing: { select: { title: true, type: true } },
        buyer: { select: { firstName: true, lastName: true, phone: true } },
        seller: { select: { firstName: true, lastName: true, phone: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async setExchangeHubReceipt(
    orderId: string,
    dto: { side: 'LISTING' | 'OFFER'; received: boolean },
  ) {
    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        type: true,
        status: true,
        exchangeHubInspection: true,
      },
    });
    if (!existing) throw new NotFoundException('سفارش یافت نشد');
    if (existing.type !== 'EXCHANGE') {
      throw new BadRequestException('این عملیات فقط برای سفارش معاوضه مجاز است');
    }
    if (
      existing.status !== OrderStatus.SHIPPED_TO_HUB &&
      existing.status !== OrderStatus.RECEIVED_AT_HUB &&
      existing.status !== OrderStatus.CHECKING_AT_HUB
    ) {
      throw new BadRequestException('سفارش در وضعیت مناسب برای ثبت دریافت مرسوله در هاب نیست');
    }

    const prev = (existing.exchangeHubInspection as Record<string, unknown> | null) ?? {};
    const next = {
      ...prev,
      sellerReceivedAtHub:
        dto.side === 'LISTING' ? dto.received : Boolean(prev['sellerReceivedAtHub']),
      buyerReceivedAtHub:
        dto.side === 'OFFER' ? dto.received : Boolean(prev['buyerReceivedAtHub']),
    };
    const bothReceived = Boolean(next.sellerReceivedAtHub) && Boolean(next.buyerReceivedAtHub);
    const targetStatus =
      existing.status === OrderStatus.CHECKING_AT_HUB
        ? OrderStatus.CHECKING_AT_HUB
        : bothReceived
          ? OrderStatus.RECEIVED_AT_HUB
          : OrderStatus.SHIPPED_TO_HUB;

    return this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: targetStatus,
        exchangeHubInspection: next as Prisma.InputJsonValue,
      },
    });
  }
}
