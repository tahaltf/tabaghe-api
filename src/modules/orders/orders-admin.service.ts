import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { OrderStatus } from '@prisma/client';
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
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('سفارش یافت نشد');

    this.stateMachine.assertTransition(
      order.status,
      nextStatus,
      'admin-hub-update',
    );

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

}
