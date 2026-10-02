import 'reflect-metadata';
import { OrderStatus } from '@prisma/client';
import { AdminOrdersHubService } from './admin-orders-hub.service';

describe('AdminOrdersHubService - exchange outbound notifications', () => {
  const makeService = (overrides?: {
    existing?: Record<string, unknown>;
    updated?: Record<string, unknown>;
  }) => {
    const existing = {
      id: 'ord-1',
      type: 'EXCHANGE',
      buyerId: 'buyer-1',
      sellerId: 'seller-1',
      listingId: 'lst-1',
      exchangeOfferId: 'offer-1',
      verificationFee: 0,
      status: OrderStatus.VERIFIED_AT_HUB,
      hubToBuyerTrackingCode: null,
      hubToSellerTrackingCode: null,
      exchangeHubInspection: {},
      buyerConfirmDeadline: null,
      cancelReason: null,
      totalAmount: 1000,
      sellerRevenue: 0,
      tradeReputationAt: null,
      ...overrides?.existing,
    };

    const updated = { ...existing, ...overrides?.updated };
    const prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(existing),
        update: jest.fn().mockResolvedValue(updated),
      },
    };
    const operationalNotify = {
      notifyMany: jest.fn().mockResolvedValue(undefined),
      notifyExchangeHubOutboundShipped: jest.fn().mockResolvedValue(undefined),
      notifyExchangeHubItemReceived: jest.fn().mockResolvedValue(undefined),
    };
    const ordersService = {
      computeBuyerConfirmDeadlineNow: jest
        .fn()
        .mockResolvedValue(new Date('2026-06-10T12:00:00.000Z')),
    };

    const service = new AdminOrdersHubService(
      prisma as never,
      {} as never,
      {} as never,
      ordersService as never,
      {} as never,
      operationalNotify as never,
      { tryTrustedShipmentRelease: jest.fn() } as never,
    );

    return { service, prisma, operationalNotify, existing };
  };

  it('notifies buyer and seller when buyer leg ships for the first time', async () => {
    const { service, operationalNotify } = makeService();

    await service.setHubShippingCodes('ord-1', {
      hubToBuyerTrackingCode: 'HB-TO-BUYER',
    });

    expect(operationalNotify.notifyExchangeHubOutboundShipped).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        leg: 'TO_BUYER',
        trackingCode: 'HB-TO-BUYER',
        isReturn: false,
      }),
    );
    expect(operationalNotify.notifyExchangeHubOutboundShipped).toHaveBeenCalledTimes(1);
  });

  it('notifies buyer and seller when seller leg ships for the first time', async () => {
    const { service, operationalNotify } = makeService({
      existing: {
        hubToBuyerTrackingCode: 'HB-TO-BUYER',
        status: OrderStatus.SHIPPED_TO_BUYER,
      },
    });

    await service.setHubShippingCodes('ord-1', {
      hubToSellerTrackingCode: 'HB-TO-SELLER',
    });

    expect(operationalNotify.notifyExchangeHubOutboundShipped).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        leg: 'TO_SELLER',
        trackingCode: 'HB-TO-SELLER',
      }),
    );
    expect(operationalNotify.notifyExchangeHubOutboundShipped).toHaveBeenCalledTimes(1);
  });

  it('notifies buyer and seller when offer item is received at hub', async () => {
    const { service, operationalNotify } = makeService({
      existing: {
        status: OrderStatus.SHIPPED_TO_HUB,
        trackingCode: '1'.repeat(24),
        sellerTrackingCode: '2'.repeat(24),
      },
    });

    await service.setExchangeHubReceipt('ord-1', {
      side: 'OFFER',
      received: true,
    });

    expect(operationalNotify.notifyExchangeHubItemReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        side: 'OFFER',
      }),
    );
  });

  it('does not notify again when offer receipt is already recorded', async () => {
    const { service, operationalNotify } = makeService({
      existing: {
        status: OrderStatus.SHIPPED_TO_HUB,
        sellerTrackingCode: '2'.repeat(24),
        exchangeHubInspection: { buyerReceivedAtHub: true },
      },
    });

    await service.setExchangeHubReceipt('ord-1', {
      side: 'OFFER',
      received: true,
    });

    expect(operationalNotify.notifyExchangeHubItemReceived).not.toHaveBeenCalled();
  });

  it('notifies seller and buyer when listing item is received at hub', async () => {
    const { service, operationalNotify } = makeService({
      existing: {
        status: OrderStatus.SHIPPED_TO_HUB,
        trackingCode: '1'.repeat(24),
        sellerTrackingCode: null,
      },
    });

    await service.setExchangeHubReceipt('ord-1', {
      side: 'LISTING',
      received: true,
    });

    expect(operationalNotify.notifyExchangeHubItemReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: 'ord-1',
        side: 'LISTING',
        bothReceived: false,
      }),
    );
  });

  it('does not re-notify when tracking code is updated again', async () => {
    const { service, operationalNotify } = makeService({
      existing: {
        hubToBuyerTrackingCode: 'HB-OLD',
        status: OrderStatus.SHIPPED_TO_BUYER,
      },
    });

    await service.setHubShippingCodes('ord-1', {
      hubToBuyerTrackingCode: 'HB-NEW',
    });

    expect(operationalNotify.notifyExchangeHubOutboundShipped).not.toHaveBeenCalled();
  });
});
